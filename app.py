from fastapi import FastAPI, Request, UploadFile, File, Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import openai
from schemas import UserResponse
from starlette.middleware.sessions import SessionMiddleware
import uuid
import redis
from urllib.parse import urlparse
import json
import os

# Initialize app and templates
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Initialize connection to redis
app.add_middleware(SessionMiddleware, secret_key=os.getenv('SESSION_KEY'))
REDIS_URL = os.getenv("RAILWAY_REDIS_URL")
if REDIS_URL is None:
    raise ValueError("REDIS_URL is not set")
url = urlparse(REDIS_URL)
pool = redis.ConnectionPool(
    host=url.hostname,
    port=url.port,
    password=url.password,
    db=0,
)

r = redis.Redis(connection_pool=pool)

openai.api_key = os.getenv('OPENAI_API_KEY')

# The text will be broken up into chunks of 2000 characters.
# ChatGPT will be sent one chunk at a time to provide questions on.
# Revision Bot will reset ChatGPTs message history and send the next chunk whenever the user selects to move on to the next chunk, or when ChatGPT reaches maximum token capacity for the current chunk.
CHUNK = 2000

# This is the default message to 'train' ChatGPT on each chunk of text
DEFAULT_MESSAGE = [
        {
        "role": "system",
        "content": "You are Revision Bot. Your role is to help users learn the contents of some notes. The student will provide you with a chunk of text that contains notes on a particular topic. Your role is to read through the notes, understand the key points, and then ask a series of questions to test the students understanding of the notes. Make sure to inform the students whether their answer is right or wrong, and why. IMPORTANT: after the student replies, make sure to provide them with the correct answer to the question you asked. Then, check if they're ready for the next question."
        },
        {
        "role": "assistant",
        "content": "Hello! I will ask you a series of questions, one by one, to help you to learn the contents of your notes via active recall. Please share your notes with me and I will start asking you some questions to test your knowledge. If you don't understand my question, simply let me know and I will explain the answer to ensure that you learn."
        }
    ]


async def reset_session_data(session_id: str):
    session_data = {}
    session_data['chunks'] = []
    session_data['current_chunk'] = 0
    session_data['notes'] = ''
    session_data['messages'] = DEFAULT_MESSAGE
    r.set(session_id, json.dumps(session_data))
    r.expire(session_id, 86400)
    return


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    session_id = str(uuid.uuid4())
    await reset_session_data(session_id)

    contents = await file.read()  # This will read the file content as bytes
    notes = contents.decode()  # Decode the bytes to string if it's a text file

    if notes:
        message = await chunkify_text(notes, session_id)
        message += await start_next_chunk(session_id)

    else:
        message = 'Notes empty'

    response = Response(content=json.dumps({"response": message}), media_type="application/json")

    # Set the session ID as a cookie in the response
    response.set_cookie(key="session_id", value=session_id)
    
    return response


@app.post("/reply")
async def reply(request: Request, user_response: UserResponse):
    if not user_response:
        message = 'Please type your response'
    else:
        session_id = request.cookies.get('session_id')
        message = await get_next_response(user_response.response, session_id)
    return {'response': message}


@app.post("/next")
async def next(request: Request):
    session_id = request.cookies.get('session_id')
    session_data = json.loads(r.get(session_id))
    if not session_data: return {'response': 'Invalid session ID.'}

    if session_data['current_chunk'] >= (len(session_data['chunks']) - 1):
        message = 'You have no more chunks left. This revision session is over.<'

    else:
        session_data['current_chunk'] += 1
        r.set(session_id, json.dumps(session_data))
        r.expire(session_id, 86400)
        message = await start_next_chunk(session_id)
    
    return {'response': message}


async def chunkify_text(text_file: str, session_id: str):
    '''
    Break text into chunks and handle them one at a time to prevent overloading ChatGPTs token capacity.
    '''
    session_data = json.loads(r.get(session_id))
    if not session_data: return {'response': 'Invalid session ID.'}
    
    session_data['chunks'] = []
    session_data['current_chunk'] = 0
    
    lines = text_file.split('\n')
    new_chunk = ''

    for line in lines:
        new_chunk += line
        if len(new_chunk) > CHUNK:
            session_data['chunks'].append(new_chunk)
            new_chunk = ''

    if new_chunk:
        session_data['chunks'].append(new_chunk)

    message_to_user = f"One chunk is ~{CHUNK} characters. Total chunks in text: {len(session_data['chunks'])}.<"
    message_to_user += "<RevAIse Bot will quiz you on the text one chunk at a time to prevent having to store too much data in memory.<<"

    r.set(session_id, json.dumps(session_data))
    r.expire(session_id, 86400)

    return message_to_user


async def start_next_chunk(session_id: str):
    '''
    Reset ChatGPTs message history and then load the next chunk of text into it. 
    '''
    session_data = json.loads(r.get(session_id))
    if not session_data: return {'response': 'Invalid session ID.'}

    session_data['messages'] = DEFAULT_MESSAGE.copy()

    session_data['messages'].extend([{
            "role": "user",
            "content": session_data['chunks'][session_data['current_chunk']]
        },
        {
            "role": "assistant",
            "content": "Excellent. Are you ready for a question? If you don't understand or aren't sure, just let me know and I will explain the answer"
        },
        {
            "role": "user",
            "content": "Great. I'm ready for a question about the notes."
        }
    ])

    try:
        # Send initial message to ChatGPT with current chunk of users notes
        response = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=session_data['messages'],
                temperature=0.5,
                max_tokens=1024,
                top_p=1,
                frequency_penalty=0,
                presence_penalty=0
            )
            
    except openai.error.InvalidRequestError:
        message = 'Sorry, I was unable to process this chunk.<'

        if session_data['current_chunk'] >= (len(session_data['chunks']) - 1):
             message += '<You have no more chunks left. This revision session is over.'
             return message
        else:
            session_data["current_chunk"] += 1
            r.set(session_id, json.dumps(session_data))
            r.expire(session_id, 86400)
            return await start_next_chunk(session_id)

    message_to_user = f"*Starting chunk {session_data['current_chunk']+1} of {len(session_data['chunks'])}*<"
    assistant_message = response['choices'][0]['message']['content']
    session_data['messages'].append({"role": "assistant", "content": assistant_message})

    r.set(session_id, json.dumps(session_data))
    r.expire(session_id, 86400)
    return message_to_user + '<[ ' + assistant_message


async def get_next_response(user_response: str, session_id: str):
    session_data = json.loads(r.get(session_id))
    if not session_data: return {'response': 'Invalid session ID.'}
    
    # Add user's message to message history
    session_data['messages'].append({
        "role": "user",
        "content": user_response
    })

    try:
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=session_data['messages'],
            temperature=0.5,
            max_tokens=2048,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0
        )

    except openai.error.InvalidRequestError:
        message = 'Maximum length hit, RevAIse Bot cannot process anymore data in this chunk.<'

        if session_data['current_chunk'] >= (len(session_data['chunks']) - 1):
             message += '<You have no more chunks left. This revision session is over.'
             return message
        else:
            session_data["current_chunk"] += 1
            r.set(session_id, json.dumps(session_data))
            r.expire(session_id, 86400)
            return await start_next_chunk(session_id)


    assistant_message = response['choices'][0]['message']['content']
    session_data['messages'].append({"role": "assistant", "content": assistant_message})

    r.set(session_id, json.dumps(session_data))
    r.expire(session_id, 86400)
    return  '[ ' + assistant_message


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse('index.html', {"request": request})


@app.get("/revise", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse('revise.html', {"request": request})