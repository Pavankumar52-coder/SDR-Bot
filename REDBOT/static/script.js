// This code was extracted from chatbot.html to create a separate script file.
// In a real-world application, you would link to this file from your HTML.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, collection, query, orderBy, addDoc, serverTimestamp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { v4 as uuidv4 } from 'https://jspm.dev/uuid';

setLogLevel('Debug');

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');
const userIdDisplay = document.getElementById('user-id-display');
const faqButtons = document.querySelectorAll('.faq-button');
const voiceToggle = document.getElementById('voice-toggle');
const leadForm = document.getElementById('lead-form');
const nameInput = document.getElementById('name');
const contactInput = document.getElementById('contact');
const locationInput = document.getElementById('location');
const emailInput = document.getElementById('email');
const companyInput = document.getElementById('company');
const queryInput = document.getElementById('query');
const leadFormSubmitButton = document.getElementById('submit-lead-form');

let isVoiceEnabled = true;

// Helper functions for audio processing
function pcmToWav(pcm16, sampleRate = 24000) {
    const pcmData = pcm16.buffer;
    const wavData = new ArrayBuffer(44 + pcmData.byteLength);
    const view = new DataView(wavData);
    let pos = 0;

    function writeString(s) {
        for (let i = 0; i < s.length; i++) {
            view.setUint8(pos++, s.charCodeAt(i));
        }
    }

    function writeUint32(d) {
        view.setUint32(pos, d, true);
        pos += 4;
    }

    function writeUint16(d) {
        view.setUint16(pos, d, true);
        pos += 2;
    }

    writeString('RIFF');
    writeUint32(36 + pcmData.byteLength);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);
    writeUint16(1);
    writeUint16(1); // Mono
    writeUint32(sampleRate);
    writeUint32(sampleRate * 2); // Byte rate
    writeUint16(2); // Block align
    writeUint16(16); // Bits per sample
    writeString('data');
    writeUint32(pcmData.byteLength);

    const pcm16View = new Int16Array(pcmData);
    for (let i = 0; i < pcm16View.length; i++) {
        view.setInt16(pos, pcm16View[i], true);
        pos += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
}

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Function to resize textarea based on content
function resizeTextarea() {
    chatInput.style.height = 'auto';
    chatInput.style.height = chatInput.scrollHeight + 'px';
}

chatInput.addEventListener('input', resizeTextarea);

let isMicRecording = false;
let recognition;

// Toggle voice on/off
voiceToggle.addEventListener('click', () => {
    isVoiceEnabled = !isVoiceEnabled;
    voiceToggle.textContent = isVoiceEnabled ? 'Voice On' : 'Voice Off';
});


async function initializeFirebase() {
    let app, db, auth;
    let userId;

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

    try {
        if (Object.keys(firebaseConfig).length > 0) {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);

            if (typeof __initial_auth_token !== 'undefined') {
                await signInWithCustomToken(auth, __initial_auth_token);
            } else {
                await signInAnonymously(auth);
            }

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    userIdDisplay.textContent = userId;
                    await fetchAndDisplayMessages(db, userId, appId);
                } else {
                    // Handle anonymous user ID
                    userId = localStorage.getItem('anon_user_id') || uuidv4();
                    localStorage.setItem('anon_user_id', userId);
                    userIdDisplay.textContent = 'Anonymous: ' + userId;
                    await fetchAndDisplayMessages(db, userId, appId);
                }
            });
        } else {
            console.error("Firebase config is not available. Chat history will not be saved.");
            userId = uuidv4();
            userIdDisplay.textContent = 'Demo User: ' + userId;
        }
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        userId = uuidv4();
        userIdDisplay.textContent = 'Demo User: ' + userId;
    }

    return { app, db, auth, userId, appId };
}

async function fetchAndDisplayMessages(db, userId, appId) {
    const messagesCollection = collection(db, `artifacts/${appId}/users/${userId}/messages`);
    const q = query(messagesCollection, orderBy('timestamp'));

    onSnapshot(q, (querySnapshot) => {
        const messages = [];
        querySnapshot.forEach((doc) => {
            messages.push(doc.data());
        });

        chatLog.innerHTML = '';
        messages.forEach(msg => {
            displayMessage(msg.text, msg.sender);
        });
        scrollToBottom();
    });
}

async function sendMessage(message, sender, db, userId, appId) {
    if (!message.trim()) return;

    const messagesCollection = collection(db, `artifacts/${appId}/users/${userId}/messages`);
    await addDoc(messagesCollection, {
        text: message,
        sender: sender,
        timestamp: serverTimestamp()
    });
}

function displayMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.innerHTML = text; // Use innerHTML to render links and breaks

    if (sender === 'user') {
        messageDiv.classList.add('user-message');
    } else {
        messageDiv.classList.add('bot-message');
    }
    chatLog.appendChild(messageDiv);
    scrollToBottom();
}

function scrollToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
}

async function speakResponse(text) {
    if (!isVoiceEnabled) return;

    const loadingIndicator = document.createElement('div');
    loadingIndicator.classList.add('bot-message', 'loader');
    chatLog.appendChild(loadingIndicator);
    scrollToBottom();

    try {
        const response = await fetch('/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) {
            throw new Error(`TTS API call failed: ${response.statusText}`);
        }

        const audioData = await response.json();
        const mimeType = audioData.mime_type;
        const base64Data = audioData.audio_data;

        const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
        const pcmData = base64ToArrayBuffer(base64Data);
        const pcm16 = new Int16Array(pcmData);
        const wavBlob = pcmToWav(pcm16, sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        audio.onended = () => URL.revokeObjectURL(audioUrl);

    } catch (error) {
        console.error("Error generating or playing speech:", error);
    } finally {
        if (loadingIndicator.parentNode) {
            loadingIndicator.parentNode.removeChild(loadingIndicator);
        }
    }
}

const { db, userId, appId } = await initializeFirebase();

// Initial bot greeting
const initialMessage = "Hi, I am SDR for Red Switch. How may I help you?";
setTimeout(() => {
    displayMessage(initialMessage, 'bot');
    speakResponse(initialMessage);
}, 500);

let conversationState = 0;

async function handleSendMessage() {
    const userMessage = chatInput.value.trim();
    if (userMessage === '') return;

    await sendMessage(userMessage, 'user', db, userId, appId);
    chatInput.value = '';
    resizeTextarea();
    
    // Send message to Flask backend to get response and new state
    const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, state: conversationState })
    });

    const data = await response.json();
    const botResponseText = data.response;
    conversationState = data.new_state;

    displayMessage(botResponseText, 'bot');
    speakResponse(botResponseText);

    // Show/hide the lead form based on the new state
    if (conversationState === 2) {
        leadForm.classList.remove('hidden');
    } else {
        leadForm.classList.add('hidden');
    }
}


sendButton.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});

// Voice recognition functionality
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    micButton.addEventListener('click', () => {
        if (isMicRecording) {
            recognition.stop();
            isMicRecording = false;
        } else {
            try {
                recognition.start();
                isMicRecording = true;
            } catch (e) {
                console.error('Speech recognition error:', e);
            }
        }
        micButton.classList.toggle('recording', isMicRecording);
    });

    recognition.onstart = () => {
        micButton.classList.add('recording');
        chatInput.placeholder = "Listening...";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
        resizeTextarea();
        handleSendMessage();
    };

    recognition.onend = () => {
        micButton.classList.remove('recording');
        chatInput.placeholder = "Type a message...";
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        micButton.classList.remove('recording');
        chatInput.placeholder = "Type a message...";
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return; // Suppress common user-related errors
        }
        displayMessage(`Voice input error: ${event.error}. Please try again.`, 'bot');
    };
} else {
    micButton.style.display = 'none';
    displayMessage("Your browser does not support the Web Speech API. Voice assistant features are disabled.", 'bot');
}


// Event listeners for the new FAQ buttons
faqButtons.forEach(button => {
    button.addEventListener('click', () => {
        chatInput.value = button.textContent;
        handleSendMessage();
    });
});

// Handle form submission for visitor details
leadFormSubmitButton.addEventListener('click', async (e) => {
    e.preventDefault();
    const visitorDetails = {
        name: nameInput.value,
        contact: contactInput.value,
        location: locationInput.value,
        email: emailInput.value,
        company: companyInput.value,
        query: queryInput.value
    };

    const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: "submit_lead_form",
            state: conversationState,
            user_data: visitorDetails
        })
    });

    const data = await response.json();
    const botResponseText = data.response;
    conversationState = data.new_state;

    displayMessage(botResponseText, 'bot');
    speakResponse(botResponseText);
    
    // Clear the form and hide it
    leadForm.reset();
    leadForm.classList.add('hidden');
});
