请求参数

Authorization
在 Header 添加参数 Authorization，其值为在 Bearer 之后拼接 Token
示例：
Authorization: Bearer ********************
Path 参数
model_name
string
必需
示例值:
gemini-2.5-flash-image
Body 参数
application/json
contents
array [object]
必需
parts
array [object]
可选
有序的内容部分，构成单个消息
generationConfig
object
可选
responseModalities
array[string]
可选
输出类型,默认情况下，模型会返回文本和图片响应
枚举值:
IMAGE
仅配置IMAGE 则仅返回图片不返回文本
TEXT
imageConfig
object
图像配置

import http.client
import json

conn = http.client.HTTPSConnection("api.tu-zi.com")
payload = json.dumps({
   "contents": [
      {
         "parts": [
            {
               "text": "兔子在赛跑"
            },
            {
               "inline_data": {
                  "mime_type": "image/jpeg",
                  "data": "iVBORw0KGgoAAAANSUhEUgAABAAAAAQACAIAAADwf7zUAAACFXRFWHRYTUw6Y29tLmFkb2JlLnhtcAA8P3hwYWNrZXQgYmVnaW49IiIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Rmo1Lz7Xam/2tozt//t7U2sULV1uXNltqmgx3RQHFSapM/9H7LSdusBrF4cFx6Drdfi3443/1+PBQkknztS9ce+VTn3aOjh9863vM/edecpdWX2ysXNaN7vBo7K/VG0oo3efx5Ml33977yP5Pf9Dryclf+1987eu/+iW3EcbTwXS8Z0dHzc0VTtePPhq89+GD7REFbuurv/ILL15tNwK1s3X/8YMn9+/dnyb1T79086VLG81u4vpGufp4PDC1cfTwT0xi+eDo135pY6l5ExwGDCkVwz1BtikAICoArGzdBsoGXRZ8BUA5cGMQzGcM41znEWQBwSwiQODXPAKNytUCrcA2Ah1N++2kjq5zc/OSai1Am9oXwk6w7Haa28dbVGs4Qb3ewmR6NJ2MqN72F9vpSURsHUJITTSKOJKTXpQ0663lFc+kuhdGJ4fH+7tKi9uqL9ZXmDX4rc7Gl49gKVpZanrdjSujwaMP7nz7R9KB1QtryZRa65e052jiJOwdHWxFvV6qFp7//EtHOw997S91gwTH00nouDWvs2RNy2mtJ25d2Nc61ZphvP343Z9Mxrx683nlo6dMeHw03D9ORopaF9durh9s70Zp1HL1xtpqgFeO9iY7u9tJ2r/x2mWnFnBohodRlMKF688tLqu0MRg3w+X663/64+lv/PpvTvrq9Vc7P/fC6tXNVLB/POBP3b5Kn0mvbjRiMwW2gwG8fefwzdevN1oQhuMkSd3AJwvkIDMJcxazAkjCTJqYLQhnq4TAogvZe1ral1KqKpCgKqvlnElclpG/IgBiTdI36QSbdcij6qEq9XJYVK0uh2MQT2LtOvVGK46jcDyyJkUipVzX9YVZCFNrUamFZrD/9MPQmKjZAjcQUpLHmlcWgIv/FaKY1AB5jkvimiQm5QGrNI6zIDVBRCIWI6isRMaMSelEAB0H0AGFQinbmK1Rup5DIQBSxEpl2wwycC8AQMoLAmSrtVZKrFgQg7Nomqpu/Rj1XmqOU+EVucQkRVEUWxElWAa8Zv/kAp8oy7DEbHP6JF9iQaI8dCtbVim7upSsBegq0ByKILMlVRMUgRQAAAoP1xzNCNneuFnXlg3BQkkWrcl27bIIW9SOsEAVPgqcGjMlE7AcL3DmgWJYM2CtXt/WDiBmzGQABRZWQgg8hRk8YVUYolERUoEanNvZYR1WQwbI76zlbSLDqsm9W23NprrCM4s27bKRCJZfI2FZepeBncP8He2bKyTI5UewAAAAASUVORK5CYII="
               }
            }
         ]
      }
   ],
   "generationConfig": {
      "responseModalities": [
         "IMAGE",
         "TEXT"
      ],
      "imageConfig": {
         "aspectRatio": "16:9"
      }
   }
})
headers = {
   'Authorization': 'Bearer <token>',
   'Content-Type': 'application/json'
}
conn.request("POST", "/v1beta/models/gemini-2.5-flash-image:generateContent", payload, headers)
res = conn.getresponse()
data = res.read()
print(data.decode("utf-8"))
