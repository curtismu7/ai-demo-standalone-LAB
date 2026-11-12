# The brain sidecar (P2b). Built and run only under the compose `brain` profile.
FROM python:3.12-slim
WORKDIR /app
COPY brain/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY brain/src/ src/
ENV PYTHONPATH=/app/src
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
