"""Agent factory — create a Pydantic AI Agent wired with all tools."""
import logging
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.models.ai_settings import AIModelConfig
from .deps import AgentDeps
from .tools import ALL_TOOLS

logger = logging.getLogger(__name__)


def create_model(config: AIModelConfig) -> OpenAIModel:
    """Build an OpenAI-compatible model from our DB config."""
    provider = OpenAIProvider(
        base_url=config.api_url,
        api_key=config.api_key,
    )
    return OpenAIModel(
        config.model_name,
        provider=provider,
    )


def create_agent(config: AIModelConfig, system_prompt: str) -> Agent[AgentDeps, str]:
    """Create a fully-wired chapter editing agent."""
    model = create_model(config)
    agent = Agent(
        model,
        deps_type=AgentDeps,
        system_prompt=system_prompt,
    )
    for tool_fn in ALL_TOOLS:
        agent.tool(tool_fn)
    return agent
