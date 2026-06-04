from ipaddress import ip_address
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix="/api/media", tags=["media"])

MAX_IMAGE_BYTES = 15 * 1024 * 1024


def is_disallowed_proxy_host(hostname: str | None) -> bool:
    if not hostname:
        return True

    host = hostname.strip().strip("[]").lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    if host.endswith(".local"):
        return True

    try:
        parsed_ip = ip_address(host)
        return (
            parsed_ip.is_private
            or parsed_ip.is_loopback
            or parsed_ip.is_link_local
            or parsed_ip.is_multicast
            or parsed_ip.is_reserved
        )
    except ValueError:
        return False


@router.get("/image-proxy")
async def proxy_image(url: str = Query(..., description="Remote image URL")):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only http(s) image URLs are supported")
    if is_disallowed_proxy_host(parsed.hostname):
        raise HTTPException(status_code=400, detail="Disallowed proxy target")

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"Accept": "image/*,*/*;q=0.8"})
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response.status_code < 500 else 502
        raise HTTPException(status_code=status, detail="Failed to fetch remote image") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch remote image") from exc

    content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Remote resource is not an image")

    content_length = resp.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=413, detail="Remote image is too large")
        except ValueError:
            pass

    body = resp.content
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Remote image is too large")

    headers = {"Cache-Control": "public, max-age=3600"}
    etag = resp.headers.get("etag")
    if etag:
        headers["ETag"] = etag

    return Response(content=body, media_type=content_type, headers=headers)
