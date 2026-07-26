"""Запуск сервиса: python run.py

Поднимает локальный сервер на http://127.0.0.1:8000
Админка: http://127.0.0.1:8000/admin
Документация API (Swagger): http://127.0.0.1:8000/docs
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
