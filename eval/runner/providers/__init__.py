from .base import Provider, Turn


def make_provider(cfg: dict) -> Provider:
    kind = cfg.get("kind")
    if kind == "anthropic":
        from .anthropic_api import AnthropicProvider
        return AnthropicProvider(**{k: v for k, v in cfg.items() if k != "kind"})
    if kind == "openai_compat":
        from .openai_compat import OpenAICompatProvider
        return OpenAICompatProvider(**{k: v for k, v in cfg.items() if k != "kind"})
    if kind == "mock":
        from .mock import MockProvider
        return MockProvider(**{k: v for k, v in cfg.items() if k != "kind"})
    raise ValueError(f"неизвестный вид провайдера: {kind!r}")
