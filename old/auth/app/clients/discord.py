from dataclasses import dataclass

import httpx

from app.core.config import Settings

DISCORD_API_BASE = "https://discord.com/api/v10"

# identify -> basic profile, guilds.members.read -> roles in a specific guild
# without needing a bot token.
OAUTH_SCOPES = "identify guilds.members.read"


class DiscordOAuthError(Exception):
    pass


@dataclass(frozen=True)
class DiscordUser:
    id: str
    username: str
    global_name: str | None
    avatar: str | None


@dataclass(frozen=True)
class DiscordGuildMember:
    role_ids: set[str]
    nick: str | None
    in_guild: bool


def build_authorize_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.discord_client_id,
        "redirect_uri": settings.discord_redirect_uri,
        "response_type": "code",
        "scope": OAUTH_SCOPES,
        "state": state,
        "prompt": "none",
    }
    query = httpx.QueryParams(params)
    return f"https://discord.com/oauth2/authorize?{query}"


async def exchange_code_for_token(settings: Settings, code: str) -> str:
    data = {
        "client_id": settings.discord_client_id,
        "client_secret": settings.discord_client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.discord_redirect_uri,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{DISCORD_API_BASE}/oauth2/token", data=data)
    if resp.status_code != 200:
        raise DiscordOAuthError(f"token exchange failed: {resp.status_code} {resp.text}")
    return resp.json()["access_token"]


async def fetch_user(access_token: str) -> DiscordUser:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DISCORD_API_BASE}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        raise DiscordOAuthError(f"fetch user failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    return DiscordUser(
        id=payload["id"],
        username=payload["username"],
        global_name=payload.get("global_name"),
        avatar=payload.get("avatar"),
    )


async def fetch_guild_member(access_token: str, guild_id: str) -> DiscordGuildMember:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DISCORD_API_BASE}/users/@me/guilds/{guild_id}/member",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code == 404:
        return DiscordGuildMember(role_ids=set(), nick=None, in_guild=False)
    if resp.status_code != 200:
        raise DiscordOAuthError(f"fetch guild member failed: {resp.status_code} {resp.text}")
    payload = resp.json()
    return DiscordGuildMember(
        role_ids=set(payload.get("roles", [])),
        nick=payload.get("nick"),
        in_guild=True,
    )
