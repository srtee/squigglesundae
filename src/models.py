from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Member(BaseModel):
    member_id: str
    display_name: str


class Location(BaseModel):
    city: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None


class IntroPost(BaseModel):
    post_id: str
    member_id: str
    member_name: str
    text: str
    location: Optional[Location] = None
    created_at: datetime
    topics: list[str] = []


class PostWithEmbedding(BaseModel):
    post_id: str
    member_id: str
    member_name: str
    text: str
    location: Optional[Location] = None
    created_at: datetime
    topics: list[str] = []
    embedding: list[float]
