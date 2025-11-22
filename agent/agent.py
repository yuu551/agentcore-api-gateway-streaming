"""
Simple Strands Agent for AgentCore Runtime
Uses BedrockAgentCoreApp for simplified deployment
"""

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool
from strands.models import BedrockModel

# Initialize the AgentCore app
app = BedrockAgentCoreApp()


@tool
def get_weather(city: str) -> str:
    """
    Get the current weather for a specified city.

    Args:
        city: The name of the city

    Returns:
        A string describing the weather
    """
    # This is a dummy implementation for demonstration
    # In a real application, you would call a weather API
    weather_data = {
        "Tokyo": "晴れ、気温25度",
        "東京": "晴れ、気温25度",
        "Osaka": "曇り、気温22度",
        "大阪": "曇り、気温22度",
        "New York": "Rainy, 18°C",
        "London": "Foggy, 15°C",
    }

    return weather_data.get(city, f"{city}の天気情報は現在利用できません")


@app.entrypoint
async def entrypoint(payload):
    """
    Main entrypoint for the agent.
    This function is called when the agent is invoked.

    Args:
        payload: The input payload containing prompt and optional model config

    Yields:
        Streaming messages from the agent
    """
    # Extract message and model configuration from payload
    message = payload.get("prompt", "")
    model_config = payload.get("model", {})
    model_id = model_config.get("modelId", "anthropic.claude-3-5-haiku-20241022-v1:0")

    # Initialize Bedrock model
    model = BedrockModel(
        model_id=model_id,
        params={"max_tokens": 4096, "temperature": 0.7},
        region="us-west-2",
    )

    # Create agent with the weather tool
    agent = Agent(
        model=model,
        tools=[get_weather],
        system_prompt="""あなたは親切なAIアシスタントです。
ユーザーの質問に丁寧に答えてください。
天気情報が必要な場合は、get_weatherツールを使用してください。""",
    )

    # Stream responses back to the caller
    stream_messages = agent.stream_async(message)
    async for msg in stream_messages:
        if "event" in msg:
            yield msg


if __name__ == "__main__":
    # Run the app when executed directly
    app.run()
