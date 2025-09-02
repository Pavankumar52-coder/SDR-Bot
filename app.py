import csv
import os
import time
import base64
import firebase_admin
import gspread
import google.generativeai as genai
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from firebase_admin import credentials, firestore

# Initialize Flask App
app = Flask(__name__)
CORS(app)

# --- Firebase and Google Sheets Setup ---
# Replace with your actual credentials file
# For a real-world app, you should use environment variables for keys.
try:
    cred = credentials.Certificate('creds.json')
    firebase_admin.initialize_app(cred)
    db_firestore = firestore.client()
except Exception as e:
    print(f"Error initializing Firebase: {e}")
    db_firestore = None

# Google Sheets API setup
try:
    gc = gspread.service_account(filename="creds.json")
    # Replace with the URL of your Google Sheet
    google_sheet = gc.open_by_url('https://docs.google.com/spreadsheets/d/1sBfZUTMs52mBecemqOxoYoHDygoEL6xqaPfr19hNloc/edit?usp=sharing')
    sheet = google_sheet.worksheet('Sheet1') # or your sheet name
except Exception as e:
    print(f"Error initializing Google Sheets API: {e}")
    sheet = None

# --- Gemini API Setup for TTS ---
try:
    # Use environment variable for the API key
    api_key = os.environ.get('GOOGLE_API_KEY')
    if api_key:
        genai.configure(api_key=api_key)
    else:
        print("GOOGLE_API_KEY not found in environment variables.")
except Exception as e:
    print(f"Error configuring Google Generative AI API: {e}")

# --- Chatbot Logic and State Machine ---
faq_answers = {
    "do you work with startups or only enterprises?": "We work with both from fast-growing startups needing quick insights to large enterprises needing complex predictive dashboards.",
    "do you offer ongoing support?": "Yes. We provide full implementation, training, and 24/7 support options depending on your plan.",
    "do you partner with cloud providers?": "Yes. We integrate seamlessly with AWS, Azure, GCP, and private/on-prem setups.",
    "what makes red switch unique?": "Unlike generic BI vendors, we focus on prediction + interactive dashboards - helping you not only see what's happening but also forecast what's next.",
    "how do you price your solutions?": "Pricing depends on scope - number of users, data sources, and complexity of predictive models. We offer flexible packages for SMEs and enterprises.",
    "how quickly can i see results?": "Usually within weeks. Once we connect your data, you'll see live dashboards right away. Predictive models take a bit longer, but still within the first quarter.",
    "how does red switch differ from other analytics vendors?": "We focus on prediction, not just reports. Our dashboards are live, interactive, and powered by predictive models, so you see both what's happening now and what's likely next.",
    "how quickly can predictive models be deployed?": "Typically within weeks. Once your data pipeline...",
    "what services does red switch provide?": "We offer solutions tailored for industries like healthcare, logistics, oil & gas, retail, and fintech.",
    "what industries does red switch serve?": "We work across pharma & healthcare, logistics & supply chain, oil & gas, retail & e-commerce, and fintech/banking.",
    "how does red switch ensure data security?": "We follow enterprise-grade security standards including encryption at rest & in transit, role-based access, and compliance with HIPAA, GDPR, and PCI-DSS.",
    "do your dashboards support real-time data?": "Yes. We integrate with ERPS, CRMs, IoT sensors, and transactional systems to update dashboards in real time.",
    "can we get role-based dashboards?": "Absolutely. We will provide the following to you, 'Executives get KPI summaries, while operations teams get detailed, drill-down dashboards'."
}

@app.route('/')
def index():
    """Serves the main HTML page for the chatbot."""
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """
    Handles incoming chat messages and updates the conversation state.
    
    The frontend sends a JSON object with 'message', 'state', and 'user_data'.
    The backend responds with 'response' and the 'new_state'.
    """
    data = request.get_json()
    message = data.get('message', '').strip().lower()
    current_state = data.get('state', 0)
    user_data = data.get('user_data', {})

    response_text = ""
    new_state = current_state

    # State 0: Initial state, handling FAQ questions and "Other Queries"
    if current_state == 0:
        if message == "other queries" or message == "idle_timeout":
            response_text = "Thank you for your query. Please provide your details, and a member of our team will be in touch shortly."
            new_state = 2
        elif message in faq_answers:
            response_text = f"{faq_answers[message]}  Can I help you with anything else? (Yes/No)"
            new_state = 1  # Transition to Yes/No state after a valid FAQ response
        else:
            response_text = "I'm sorry, I don't understand that. Please select one of the options or type 'Other Queries' for more assistance."
            new_state = 0

    # State 1: Awaiting a Yes/No response
    elif current_state == 1:
        if message == 'yes':
            response_text = "Great! How else can I help you?"
            new_state = 0
        elif message == 'no':
            response_text = "Thank you for chatting with me. Have a great day!"
            new_state = 3  # A new state to indicate the conversation is over
        else:
            response_text = "I'm sorry, I didn't understand that. Can I help you with anything else? (Yes/No)"
            new_state = 1

    # State 2: Handling the lead form submission
    elif current_state == 2:
        if message == "submit_lead_form":
            name = user_data.get('name')
            contact = user_data.get('contact_number')
            location = user_data.get('location')
            email = user_data.get('email')
            comments = user_data.get('comments')
            
            # Use Google Sheets if available, otherwise fallback to CSV
            if sheet and name and contact and location and email and comments:
                try:
                    row_data = [name, contact, location, email, comments, time.strftime("%Y-%m-%d %H:%M:%S")]
                    sheet.append_row(row_data)
                    response_text = "Thank you! A member of our team will contact you shortly. for further details Mail id:info@redswitchglobal.com, Contact number: +91 9831076943, +91 7977167595."
                    new_state = 0
                except Exception as e:
                    print(f"Error appending to Google Sheet: {e}")
                    response_text = "There was an error submitting your details. Please try again or contact us directly."
                    new_state = 2
            else:
                # Fallback to a simple local file if Google Sheets fails
                LEAD_DATA_FILE = 'leads.csv'
                if not os.path.exists(LEAD_DATA_FILE):
                    with open(LEAD_DATA_FILE, 'w', newline='') as file:
                        writer = csv.writer(file)
                        writer.writerow(['name', 'contact_number', 'location', 'email', 'comments', 'timestamp'])
                
                with open(LEAD_DATA_FILE, 'a', newline='') as file:
                    writer = csv.writer(file)
                    writer.writerow([name, contact, location, email, comments, time.strftime("%Y-%m-%d %H:%M:%S")])
                
                response_text = "Thank you! A member of our team will contact you shortly. for further details Mail id:info@redswitchglobal.com, Contact number: +91 9831076943, +91 7977167595 "
                new_state = 0

        else:
            response_text = "Please provide all the required details to get a personalized response."
            new_state = 2
    
    # State 3: Conversation ended. No more interaction.
    # The frontend should handle this by disabling the input.
    elif current_state == 3:
        response_text = ""
        new_state = 3

    return jsonify({"response": response_text, "new_state": new_state})

@app.route('/tts', methods=['POST'])
def tts():
    """Endpoint for TTS. Generates audio from text using Gemini API."""
    data = request.get_json()
    text = data.get('text', '')
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    try:
        response = genai.GenerativeModel("gemini-2.5-flash-preview-tts").generate_content(
            text,
            generation_config={"response_modalities": ["AUDIO"]}
        )
        audio_part = next(part for part in response.candidates[0].content.parts if part.inline_data)
        mime_type = audio_part.inline_data.mime_type
        audio_data_base64 = base64.b64encode(audio_part.inline_data.data).decode('utf-8')

        return jsonify({'audio_data': audio_data_base64, 'mime_type': mime_type})

    except Exception as e:
        print(f"Error during TTS generation: {e}")
        return jsonify({'error': 'Failed to generate speech'}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
