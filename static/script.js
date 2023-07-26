document.addEventListener("DOMContentLoaded", function() {
    const nextButton = document.getElementById('next-chunk');
    const submitButton = document.getElementById('submit-response');
    const uploadButton = document.getElementById('upload-file');
    const fileInput = document.getElementById('file-input');
    const downloadButton = document.getElementById('download-log');
    const userInput = document.getElementById('user-input');
    const chatLog = document.getElementById('log');

    var typing = false;

    downloadButton.disabled = true;
    submitButton.disabled = true;
    nextButton.disabled = true;
    userInput.disabled = true;
    uploadButton.disabled = true;

    fileInput.addEventListener("change", function() {

        if (fileInput.files.length > 0) {
            uploadButton.disabled = false;
        } else {
            uploadButton.disabled = true;
        }
    })

    userInput.addEventListener("keyup", function() {
        if (userInput.value && !typing) {
            submitButton.disabled = false;
        } else {
            submitButton.disabled = true;
        }
    });

    function downloadLog() {
        const log = chatLog.innerText;
        const blob = new Blob([log], {type: 'text/plain'});
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chatlog.txt';
        a.click();
    }

    async function uploadFile() {
        uploadButton.disabled = true;
        chatLog.innerHTML = ''
        const file = fileInput.files[0];

        if (file.type !== 'text/plain' && file.type !== 'text/markdown') {
            printMessage('Invalid file type. Please select a .txt file.');
            return;
        }

        const fileSizeInMegabytes = file.size / (1024*1024); 

        if (fileSizeInMegabytes > 1) { 
            printMessage('File is too large. Please select a file that is less than 1 MB.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        });

        const result = await response.json();

        printMessage(result.response)
    }

    async function printMessage(message) {
        window.scrollTo(0, document.body.scrollHeight);
        downloadButton.disabled = true;
        nextButton.disabled = true;
        typing = true;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'assistant-div';  // This will be either 'user' or 'assistant'

        const messagePara = document.createElement('p');
        messagePara.className = 'assistant-message';

        messageDiv.appendChild(messagePara)
        chatLog.appendChild(messageDiv);

        for (const char of message) {
            if (char == '<') {
                messagePara.innerHTML += '<br>'
            } else if (char == '[') {
                messagePara.innerHTML += '<b>RevAIse Bot:</b>'
            } else {
                messagePara.innerHTML += char;
            }
            chatLog.scrollTop = chatLog.scrollHeight;
            await delay(15) // Control typing speed
        }

        userInput.disabled = false;
        nextButton.disabled = false;
        downloadButton.disabled = false;
        typing = false;
    }
    
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function sendResponse() {
        const reply = userInput.value;
        userInput.value = '';
        submitButton.disabled = true;
        userInput.disabled = true;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'user-div';  // This will be either 'user' or 'assistant'
    
        
        const messagePara = document.createElement('p');
        messagePara.className = 'user-message'

        messageDiv.appendChild(messagePara)
        chatLog.appendChild(messageDiv);

        messagePara.innerHTML += '<b>You:</b> ' + reply
        chatLog.scrollTop = chatLog.scrollHeight;

        const response = await fetch('/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ response: reply }),
            credentials: 'same-origin' 
        });

        const result = await response.json();
        printMessage(result.response)
    };

    async function nextChunk() {
        nextButton.disabled = true;
        const response = await fetch('/next', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'same-origin'
        });

        const result = await response.json();
        await printMessage(result.response);
    };

    submitButton.addEventListener("click", sendResponse);
    document.getElementById('upload-file').addEventListener("click", uploadFile);
    nextButton.addEventListener("click", nextChunk);
    downloadButton.addEventListener("click", downloadLog);
});