from app.api.routes.media_proxy import is_disallowed_proxy_host


def test_is_disallowed_proxy_host_rejects_local_targets():
    assert is_disallowed_proxy_host("localhost") is True
    assert is_disallowed_proxy_host("127.0.0.1") is True
    assert is_disallowed_proxy_host("::1") is True
    assert is_disallowed_proxy_host("192.168.1.1") is True


def test_is_disallowed_proxy_host_allows_public_hostnames():
    assert is_disallowed_proxy_host("dashscope-7c2c.oss-accelerate.aliyuncs.com") is False
    assert is_disallowed_proxy_host("deepwood.oss-cn-beijing.aliyuncs.com") is False
