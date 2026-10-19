FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY SMART_backend ./SMART_backend
COPY SMART_Bridge ./SMART_Bridge
COPY SMART_Frontend ./SMART_Frontend

RUN cd SMART_backend && g++ -std=c++17 main.cpp -o smart_backend

WORKDIR /app/SMART_Bridge
CMD ["python", "smart_bridge.py", "--backend", "../SMART_backend/smart_backend", "--frontend", "../SMART_Frontend", "--host", "0.0.0.0"]