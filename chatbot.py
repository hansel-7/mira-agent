import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    base_url="https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1",
    api_key=os.getenv("HACKATHON_API_KEY"),
)

SYSTEM_PROMPT = "You are Mira, a helpful AI assistant."

def chat(history: list[dict]) -> str:
    stream = client.chat.completions.create(
        model="google/gemma-4-31b-it",
        messages=[{"role": "system", "content": SYSTEM_PROMPT}] + history,
        max_tokens=2000,
        temperature=1,
        top_p=0.7,
        presence_penalty=0,
        stream=True,
    )
    response = ""
    print("\nMira: ", end="", flush=True)
    for chunk in stream:
        if not chunk.choices:
            continue
        content = chunk.choices[0].delta.content
        if content:
            print(content, end="", flush=True)
            response += content
    print()
    return response


def main():
    print("Mira Chatbot — type 'exit' to quit\n")
    history = []
    while True:
        user_input = input("You: ").strip()
        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            print("Bye!")
            break
        history.append({"role": "user", "content": user_input})
        reply = chat(history)
        history.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
