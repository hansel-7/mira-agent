import os
import json
from flask import Flask, render_template, request, Response, stream_with_context
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

client = OpenAI(
    base_url="https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1",
    api_key=os.getenv("HACKATHON_API_KEY"),
)

SYSTEM_PROMPT = "You are Mira, a helpful AI assistant."


@app.route("/health")
def health():
    return {"status": "ok"}, 200


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    history = request.json.get("history", [])

    def generate():
        stream = client.chat.completions.create(
            model="google/gemma-4-31b-it",
            messages=[{"role": "system", "content": SYSTEM_PROMPT}] + history,
            max_tokens=2000,
            temperature=1,
            top_p=0.7,
            presence_penalty=0,
            stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            content = chunk.choices[0].delta.content
            if content:
                yield f"data: {json.dumps({'content': content})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
