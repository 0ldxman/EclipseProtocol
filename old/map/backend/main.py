from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from routers import sides, countries, provinces, map

app = FastAPI(title="Aether Wiki Map")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sides.router)
app.include_router(countries.router)
app.include_router(provinces.router)
app.include_router(map.router)

app.mount("/geo", StaticFiles(directory="data/geo"), name="geo")
app.mount("/admin", StaticFiles(directory="../frontend/admin/dist", html=True), name="admin")
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
