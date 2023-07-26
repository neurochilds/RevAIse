from pydantic import BaseModel


'''
The schemas (Pydantic models) give information about the structure and type of data the API will process.
FastAPI uses schemas to: 
- validate incoming requests by ensuring the incoming JSON data matches the schema. If not, it sends back a 422 error.
- parse the incoming JSON data into the Python types defined in the schema.
'''


class UserResponse(BaseModel):
    response: str