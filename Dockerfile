FROM python:3.11
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt
ENV PORT=7860
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT}
