document.addEventListener("DOMContentLoaded", function() {
    const nextButton = document.getElementById('next-chunk');
    const submitResponseButton = document.getElementById('submit-response');
    const submitNotesButton = document.getElementById('submit-notes');
    const pastedNotes = document.getElementById('notes-input');
    const uploadButton = document.getElementById('upload-file');
    const fileInput = document.getElementById('file-input');
    const downloadButton = document.getElementById('download-log');
    const userInput = document.getElementById('user-input');
    const chatLog = document.getElementById('log');

    var typing = false;

    downloadButton.disabled = true;
    submitResponseButton.disabled = true;
    submitNotesButton.disabled = true;
    nextButton.disabled = true;
    userInput.disabled = true;
    uploadButton.disabled = true;

    pastedNotes.addEventListener("input", function() {
        if (pastedNotes.value) {
            submitNotesButton.disabled = false;
        } else {
            submitNotesButton.disabled = true;
        }
    });

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.js';

    function extractText(pdfUrl) {
        var pdf = pdfjsLib.getDocument(pdfUrl);
        return pdf.promise.then(function (pdf) {
            var totalPageCount = pdf.numPages;
            var countPromises = [];
            for (
                var currentPage = 1;
                currentPage <= totalPageCount;
                currentPage++
            ) {
                var page = pdf.getPage(currentPage);
                countPromises.push(
                    page.then(function (page) {
                        var textContent = page.getTextContent();
                        return textContent.then(function (text) {
                            return text.items
                                .map(function (s) {
                                    return s.str;
                                })
                                .join('');
                        });
                    }),
                );
            }

            return Promise.all(countPromises).then(function (texts) {
                return texts.join('');
            });
        });
    };

    async function submitNotes() {
        if (!pastedNotes.value.trim()) {
            printMessage('Please paste your notes before submitting.');
            return;
        }

        // Create a Blob object from the textarea input with a MIME type of plain text
        // Append the Blob as a file named 'notes.txt' to the FormData object under the key 'file'
        // Allows the pasted/typed notes to be sent to same /upload API endpoint and be handled same way as uploaded .txt or .md files
        const file = new Blob([pastedNotes.value], { type: 'text/plain' });
        const formData = new FormData();
        formData.append('file', file, 'notes.txt');

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        });

        const result = await response.json();
        pastedNotes.value = '';
        submitNotesButton.disabled = true;
        printMessage(result.response)
    };

    fileInput.addEventListener("change", function() {
        if (fileInput.files.length > 0) {
            uploadButton.disabled = false;
        } else {
            uploadButton.disabled = true;
        }
    });

    async function uploadFile() {
        uploadButton.disabled = true;
        chatLog.innerHTML = ''
        let file = fileInput.files[0];

        const fileExtension = file.name.split('.').pop();
        const extensions = ['txt', 'md', 'docx', 'pdf']

        if (!extensions.includes(fileExtension)) {
            printMessage('Invalid file type. Please select a .txt, .md, .docx, or .pdf file.');
            return;
        }

        const fileSizeInMegabytes = file.size / (1024*1024); 

        if (fileSizeInMegabytes > 5) { 
            printMessage('File is too large. Please select a file that is less than 5 MB.');
            return;
        }

        if (fileExtension === 'pdf') {
            const text = await extractText(file);
            file = new Blob([text], { type: 'text/plain' });
        } 
        
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });

            const result = await response.json();
            printMessage(result.response)
        }   catch (error) {
            printMessage('Failed to upload file: ' + error.message);
        }
    };

    async function printMessage(message) {
        window.scrollTo(0, document.body.scrollHeight);
        downloadButton.disabled = true;
        nextButton.disabled = true;
        typing = true;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'assistant-div';  

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


    userInput.addEventListener("keyup", function() {
        if (userInput.value && !typing) {
            submitResponseButton.disabled = false;
        } else {
            submitResponseButton.disabled = true;
        }
    });


    userInput.addEventListener("keydown", function(event) {
        if (event.key === 'Enter') {
            sendResponse();
        }
    });


    async function sendResponse() {
        const reply = userInput.value;
        userInput.value = '';
        submitResponseButton.disabled = true;
        userInput.disabled = true;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'user-div'; 
    
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

    function downloadLog() {
        const log = chatLog.innerText;
        const blob = new Blob([log], {type: 'text/plain'});
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chatlog.txt';
        a.click();
    }

    document.getElementById('submit-notes').addEventListener("click", submitNotes);
    submitResponseButton.addEventListener("click", sendResponse);
    document.getElementById('upload-file').addEventListener("click", uploadFile);
    nextButton.addEventListener("click", nextChunk);
    downloadButton.addEventListener("click", downloadLog);
});