// Service Worker - 图片缓存
const CACHE_NAME = 'dw-image-cache-v1';

// 处理消息通道错误
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 需要缓存的图片域名
const IMAGE_HOSTS = [
  'deepwood.oss-cn-beijing.aliyuncs.com',
  'dashscope-result-bj.oss-cn-beijing.aliyuncs.com',
];

// 图片文件扩展名
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

// 判断是否是图片请求
function isImageRequest(url) {
  const urlObj = new URL(url);

  // 检查是否是图片域名
  if (!IMAGE_HOSTS.some(host => urlObj.hostname.includes(host))) {
    return false;
  }

  // 检查是否是图片扩展名
  const pathname = urlObj.pathname.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => pathname.includes(ext));
}

// 获取缓存 key（去除动态参数如 _canvas）
function getCacheKey(url) {
  const urlObj = new URL(url);
  // 保留必要参数（如 OSS 签名），但去除前端添加的随机参数
  urlObj.searchParams.delete('_canvas');
  urlObj.searchParams.delete('_t');
  urlObj.searchParams.delete('_');
  return urlObj.toString();
}

// 安装事件
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker 安装');
  self.skipWaiting();
});

// 激活事件
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker 激活');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 删除旧版本缓存
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 拦截请求
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 只处理图片请求
  if (!isImageRequest(url)) {
    return;
  }

  // 跨域请求检测 - 跨域图片直接放行，让浏览器通过 <img> 标签加载（不受 CORS 限制）
  const urlObj = new URL(url);
  const isCrossOrigin = urlObj.origin !== self.location.origin;

  if (isCrossOrigin) {
    // 不拦截跨域请求，避免 CORS 问题
    return;
  }

  const cacheKey = getCacheKey(url);

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(cacheKey).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[SW] 缓存命中:', cacheKey.substring(0, 80));
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            cache.put(cacheKey, responseToCache);
            console.log('[SW] 缓存新图片:', cacheKey.substring(0, 80));
          }
          return networkResponse;
        }).catch((error) => {
          console.error('[SW] 网络请求失败:', error);
          throw error;
        });
      });
    })
  );
});
