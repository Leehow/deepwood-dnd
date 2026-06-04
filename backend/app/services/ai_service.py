import httpx
import asyncio
from typing import List, Dict, Any, AsyncGenerator, Optional
from app.schemas.ai_settings import ModelInfo, ModelsListResponse


class AIService:
    """Service for interacting with OpenAI-compatible APIs"""

    @staticmethod
    def _supports_sampling_params(model: str) -> bool:
        """Return False for models that don't accept temperature/top_p/max_tokens (e.g., gpt-5)."""
        m = (model or "").lower()
        return not ("gpt-5" in m)

    @staticmethod
    async def generate_completion(
        api_url: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = 0.7,
        max_tokens: int = 1000,
        timeout: float = 120.0  # Default 2 minutes, can be overridden
    ) -> str:
        """
        Generate text completion using OpenAI-compatible API.
        Supports graceful cancellation on shutdown.
        """
        # Import here to avoid circular import
        from app.main import shutdown_event

        # Build chat completions URL
        api_url = api_url.rstrip("/")
        chat_url = f"{api_url}/chat/completions"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": model,
            "messages": messages,
        }
        if AIService._supports_sampling_params(model):
            if temperature is not None:
                payload["temperature"] = temperature
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(timeout=timeout, http2=False) as client:
            # Create task and monitor shutdown event
            request_task = asyncio.create_task(
                client.post(chat_url, headers=headers, json=payload)
            )

            # Wait for either request completion or shutdown
            done, pending = await asyncio.wait(
                [request_task, asyncio.create_task(shutdown_event.wait())],
                return_when=asyncio.FIRST_COMPLETED
            )

            # Check if shutdown was triggered
            if shutdown_event.is_set():
                request_task.cancel()
                try:
                    await request_task
                except asyncio.CancelledError:
                    pass
                raise asyncio.CancelledError("Request cancelled due to server shutdown")

            # Get the response
            response = request_task.result()
            response.raise_for_status()

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            return content

    @staticmethod
    async def fetch_models(api_url: str, api_key: str) -> List[ModelInfo]:
        """
        Fetch available models from OpenAI-compatible API

        Args:
            api_url: The base API URL
            api_key: The API key for authentication

        Returns:
            List of available models

        Raises:
            httpx.HTTPError: If the request fails
        """
        # Ensure URL ends with /v1
        if not api_url.endswith("/v1"):
            api_url = api_url.rstrip("/") + "/v1"

        models_url = f"{api_url}/models"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(models_url, headers=headers)
            response.raise_for_status()

            data = response.json()

            # Parse response according to OpenAI API format
            if isinstance(data, dict) and "data" in data:
                models = [ModelInfo(**model) for model in data["data"]]
            else:
                # Fallback for non-standard responses
                models = []

            return models

    @staticmethod
    async def test_api_connection(api_url: str, api_key: str) -> bool:
        """
        Test if the API connection is valid

        Args:
            api_url: The base API URL
            api_key: The API key for authentication

        Returns:
            True if connection is successful, False otherwise
        """
        try:
            models = await AIService.fetch_models(api_url, api_key)
            return len(models) > 0
        except Exception:
            return False

    @staticmethod
    async def generate_completion_stream(
        api_url: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = 0.7,
        max_tokens: int = 1000
    ) -> AsyncGenerator[str, None]:
        """
        Generate text completion with streaming using OpenAI-compatible API

        Args:
            api_url: The base API URL
            api_key: The API key for authentication
            model: The model name to use
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature (0.0 to 2.0), None to omit
            max_tokens: Maximum tokens to generate

        Yields:
            Text chunks as they are generated
        """
        api_url = api_url.rstrip("/")
        chat_url = f"{api_url}/chat/completions"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": model,
            "messages": messages,
            "stream": True  # Enable streaming
        }
        if AIService._supports_sampling_params(model):
            if temperature is not None:
                payload["temperature"] = temperature
            payload["max_tokens"] = max_tokens

        # Always use HTTP/1.1 for streaming to avoid h2 dependency issues
        import json as json_module

        # Increase timeout to 120 seconds for slow APIs
        async with httpx.AsyncClient(timeout=120.0, http2=False) as client:
            async with client.stream("POST", chat_url, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    error_detail = error_text.decode('utf-8')
                    raise ValueError(f"API 请求失败 ({response.status_code}): {error_detail}")

                has_content = False
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]  # Remove "data: " prefix

                        if data_str.strip() == "[DONE]":
                            break

                        try:
                            data = json_module.loads(data_str)
                            if isinstance(data, dict):
                                # Try delta.content first (OpenAI format)
                                delta = data.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")

                                # If no content in delta, try message.content (Qwen format)
                                if not content:
                                    message = data.get("choices", [{}])[0].get("message", {})
                                    content = message.get("content", "")

                                if content:
                                    has_content = True
                                    yield content
                        except Exception:
                            # Skip malformed lines
                            continue

                # If no content was yielded, the model might be a reasoning model
                # that only outputs reasoning_tokens without actual content
                if not has_content:
                    raise ValueError(
                        "模型未返回任何内容。这可能是因为使用了推理模型（reasoning model），"
                        "它只进行内部思考而不输出文本。请在 API 设置中更换为普通的语言模型。"
                    )

    @staticmethod
    async def generate_with_tools(
        api_url: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        temperature: Optional[float] = 0.7,
        max_tokens: int = 2000,
        tool_choice: str = "auto"
    ) -> Dict[str, Any]:
        """
        Generate completion with function calling/tools support

        Args:
            api_url: The base API URL
            api_key: The API key for authentication
            model: The model name to use
            messages: List of message dicts
            tools: List of tool definitions (OpenAI format)
            temperature: Sampling temperature, None to omit
            max_tokens: Maximum tokens to generate
            tool_choice: "auto", "required", or {"type": "function", "function": {"name": "xxx"}}

        Returns:
            Dict with 'content' (text response) and/or 'tool_calls' (list of function calls)
        """
        import json as json_module

        api_url = api_url.rstrip("/")
        chat_url = f"{api_url}/chat/completions"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": tool_choice,
        }
        if AIService._supports_sampling_params(model):
            if temperature is not None:
                payload["temperature"] = temperature
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(timeout=60.0, http2=False) as client:
            response = await client.post(chat_url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()
            choice = data.get("choices", [{}])[0]
            message = choice.get("message", {})

            result = {
                "content": message.get("content", ""),
                "tool_calls": []
            }

            # Parse tool calls if present
            if message.get("tool_calls"):
                for tc in message["tool_calls"]:
                    func = tc.get("function", {})
                    try:
                        args = json_module.loads(func.get("arguments", "{}"))
                    except json_module.JSONDecodeError:
                        args = {}

                    result["tool_calls"].append({
                        "id": tc.get("id"),
                        "name": func.get("name"),
                        "arguments": args
                    })

            return result

    @staticmethod
    async def chat_completion(
        api_url: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = 0.7,
        max_tokens: int = 1000
    ) -> str:
        """
        Alias for generate_completion for compatibility
        """
        return await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens
        )

    @staticmethod
    async def generate_with_image(
        api_url: str,
        api_key: str,
        model: str,
        system_prompt: str,
        user_message: str,
        image_base64: str,
        temperature: Optional[float] = 0.7,
        max_tokens: int = 4000
    ) -> str:
        """
        Generate completion with image input using multi-modal LLM

        Args:
            api_url: The base API URL
            api_key: The API key for authentication
            model: The model name to use (must support vision)
            system_prompt: System prompt for the LLM
            user_message: Text message from user
            image_base64: Base64 encoded image (with or without data URI prefix)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate

        Returns:
            Generated text content
        """
        api_url = api_url.rstrip("/")
        chat_url = f"{api_url}/chat/completions"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # Ensure image_base64 has proper data URI prefix
        if not image_base64.startswith("data:"):
            # Assume JPEG if no prefix
            image_base64 = f"data:image/jpeg;base64,{image_base64}"

        # Build multi-modal message with image
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_base64
                        }
                    },
                    {
                        "type": "text",
                        "text": user_message
                    }
                ]
            }
        ]

        payload = {
            "model": model,
            "messages": messages,
        }
        if AIService._supports_sampling_params(model):
            if temperature is not None:
                payload["temperature"] = temperature
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(timeout=300.0, http2=False) as client:
            response = await client.post(chat_url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            return content
