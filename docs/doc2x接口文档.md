Doc2x API  v2 PDF 接口文档
修改记录

- 2024-11-11 新增 preupload接口
- 2025-03-05 新增图片输入接口

图片接口文档：

- Doc2X API v2 图片接口文档

其他参考

- 使用 LLM 进行多级标题层级增强的例子参考
常见问题:
Doc2X 常见问题 - FAQ
Base URL: <https://v2.doc2x.noedgeai.com>

1. 请直连访问 API 接口，中国内地以外地区可能有较大网络波动，导致上传文件断流严重
2. 不建议接入大规模线上服务，由于算力有限，可能会出现排队情况（表现为轮询时进度为 0），更适合批量处理数据
3. 通过 status 得到结果之后，如果有保存图片的需求，请尽快手动下载或通过导出接口获取图片到本地，服务器上只临时保留 24h 的结果
Authorizaton 鉴权
首先需要获取到API Key(类似于sk-xxx) 获取API网址: open.noedgeai.com
在HTTP请求头加入:
Authorization: Bearer sk-xxx

暂时无法在飞书文档外展示此内容
暂时无法在飞书文档外展示此内容
POST /api/v2/parse/pdf PDF识别（直接上传）不推荐
此接口为异步调用接口，注意仅支持文件大小<=300MB，更大的文件使用 /api/v2/parse/preupload
请求参数
名称
位置
类型
必选
说明
body
body
binary
是
请求体为 pdf 的二进制，最大不超过300M
请求示例
curl -X POST '<https://v2.doc2x.noedgeai.com/api/v2/parse/pdf>' \
--header 'Authorization: Bearer sk-xxx' \
--data-binary '@test2.pdf'
注意，--data-binary 并不是formdata，而是以二进制形式写入body中，python代码如下：
import requests

url = '<https://v2.doc2x.noedgeai.com/api/v2/parse/pdf>'
headers = {'Authorization': 'Bearer sk-xxx'}

with open('test2.pdf', 'rb') as file:
    response = requests.post(url, headers=headers, data=file) # 使用data

print(response.text)
返回示例
{
    "code": "success",
    "data": {
        "uid": "01920000-0000-0000-0000-000000000000"
    }
}
根据这个uid，请求/api/v2/parse/status获得解析状态和解析结果。

POST /api/v2/parse/preupload 文件预上传
推荐使用该接口, 有更快的上传速度
大文件上传接口，文件大小<=1GB
请求参数
无
请求示例
curl -X POST '<https://v2.doc2x.noedgeai.com/api/v2/parse/preupload>' \
--header 'Authorization: Bearer sk-xxx'
返回示例
{
    "code": "success",
    "data": {
        "uid": "0192d745-5776-7261-abbd-814df3af3449",
        "url": "<https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/0192d745-5776-7261-abbd-814df3af3449.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=LTAI5tS7hV6uXXVzcpk3EGfX%2F20241029%2Fcn-beijing%2Fs3%2Faws4_request&X-Amz-Date=20241029T075458Z&X-Amz-Expires=600&X-Amz-SignedHeaders=host&X-Amz-Signature=REDACTED>"
    }
}
获取到url之后，使用HTTP PUT方法上传文件到返回结果中的url字段，然后使用/api/v2/parse/status 接口轮询结果，使用的是阿里云的oss，具体速度取决于您的网速（海外用户速度可能上传失败）。
接口说明
  流程图如下：
暂时无法在飞书文档外展示此内容
其中异常报错(例如处理进程上限限制/处理页数上限限制)会在status接口返回

- python示例
import json
import time
import requests as rq

base_url = "<https://v2.doc2x.noedgeai.com>"
secret = "sk-xxx"

def preupload():
    url = f"{base_url}/api/v2/parse/preupload"
    headers = {
        "Authorization": f"Bearer {secret}"
    }
    res = rq.post(url, headers=headers)
    if res.status_code == 200:
        data = res.json()
        if data["code"] == "success":
            return data["data"]
        else:
            raise Exception(f"get preupload url failed: {data}")
    else:
        raise Exception(f"get preupload url failed: {res.text}")

def put_file(path: str, url: str):
    with open(path, "rb") as f:
        res = rq.put(url, data=f) # body为文件二进制流
        if res.status_code != 200:
            raise Exception(f"put file failed: {res.text}")

def get_status(uid: str):
    url = f"{base_url}/api/v2/parse/status?uid={uid}"
    headers = {
        "Authorization": f"Bearer {secret}"
    }
    res = rq.get(url, headers=headers)
    if res.status_code == 200:
        data = res.json()
        if data["code"] == "success":
            return data["data"]
        else:
            raise Exception(f"get status failed: {data}")
    else:
        raise Exception(f"get status failed: {res.text}")

upload_data = preupload()
print(upload_data)
url = upload_data["url"]
uid = upload_data["uid"]

put_file("test.pdf", url)

while True:
    status_data = get_status(uid)
    print(status_data)
    if status_data["status"] == "success":
        result = status_data["result"]
        with open("result.json", "w") as f:
            json.dump(result, f)
        break
    elif status_data["status"] == "failed":
        detail = status_data["detail"]
        raise Exception(f"parse failed: {detail}")
    elif status_data["status"] == "processing":
        # processing
        progress = status_data["progress"]
        print(f"progress: {progress}")
        time.sleep(3)

{'uid': '', 'url': ''}
{'status': 'processing', 'progress': 0, 'detail': '等待文件上传'}
progress: 0
{'status': 'processing', 'progress': 0, 'detail': '任务进行中'}
progress: 0
{'status': 'processing', 'progress': 5, 'detail': '任务进行中'}
progress: 5
{'status': 'processing', 'progress': 90, 'detail': '任务进行中'}
progress: 90
{'status': 'processing', 'progress': 91, 'detail': '任务进行中'}
progress: 91
{'status': 'processing', 'progress': 99, 'detail': '任务进行中'}
progress: 99
{'status': 'processing', 'progress': 99, 'detail': '任务进行中'}
progress: 99
{'status': 'processing', 'progress': 99, 'detail': '任务进行中'}
progress: 99
...result

- 由于用户上传到OSS之后，服务端拉取有一定延迟，所以上传文件之后状态不会立刻更新到“任务进行中”，需要等待(<20s)
- 获得链接之后5min内有效，注意时间
- url链接不能重复使用：如果http put失败（即status_code!=200）可以重试，put如果获得200返回，链接不能重复使用
- 由于在上传文件前无法知晓页数，触发速率限制(parse_concurrency_limit, parse_task_limit_exceeded)的提示仅会在status接口中触发
以下是在通过preupload接口上传，触发错误时在status接口获得的内容示例：
{'code': 'parse_page_limit_exceeded', 'msg': '页数超过限制'}
{'code': 'parse_error', 'msg': '解析错误'}
其中code详细参见错误码：
错误代码
原因
解决方案
parse_task_limit_exceeded
任务数超限制
正在处理的任务数量达到上限, 等待先前提交的任务完成
parse_concurrency_limit
任务文件页数超限
正在处理的任务页数达到上限,等候先前提交的任务完成
parse_quota_limit
可用的解析页数额度不足
当前可用的页数不够
parse_error
解析错误
短暂等待后重试, 如果还出现报错则请联系负责人
parse_create_task_error
创建任务失败
短暂等待后重试, 如果还出现报错则请联系负责人
parse_status_not_found
状态过期或uid错误
短暂等待后重试, 如果还出现报错则请联系负责人
parse_file_too_large
单个文件大小超过限制
当前允许单个文件大小 <= 300M, 请拆分 pdf
parse_page_limit_exceeded
单个文件页数超过限制
当前允许单个文件页数 <= 1000页, 请拆分 pdf
parse_file_lock
文件解析失败
为了防止反复解析, 暂时锁定一天
考虑PDF可能有兼容性问题, 重新打印后再尝试
仍然失败请反馈request_id给负责人
parse_file_not_pdf
传入的文件不是PDF文件
请解析后缀为.pdf的文件
GET /api/v2/parse/status 查看异步状态
使用上方的异步调用后, 用这个接口轮询状态, 建议轮询频率为1~3s每次
云端每个 status （包括cdn 上的图片）仅在 24h 内可以查询到结果，请尽快导出（见Doc2x API  v2 PDF 接口文档）与保存
请求参数
- 请求头
名称
描述
示例值
Authorization
Api key
Bearer REDACTED_API_KEY
- 请求体
名称
位置
类型
必选
说明
uid
query
string
是
异步任务的 id
请求示例
curl --request GET '<https://v2.doc2x.noedgeai.com/api/v2/parse/status?uid=01920000-0000-0000-0000-000000000000>' --header 'Authorization: Bearer sk-xxx'
Python代码如下：
import requests

url = '<https://v2.doc2x.noedgeai.com/api/v2/parse/status?uid=01920000-0000-0000-0000-000000000000>'
headers = {'Authorization': 'Bearer sk-xxx'}

response = requests.get(url, headers=headers)

print(response.text)
返回示例
名称
类型
描述
示例值
code
string
状态码
success
msg
string
详细信息
ok
data
object
返回数据
见下方详细示例
根据这个uid轮询获得解析状态和解析结果。
{
  "code": "success",
  "data": {
       "progress": 100,
       "status": "success",
       "detail": "",
       "result": {
           "version":"v2",
           "pages":[
               {
                    "url": "",
                    "page_idx": 0,
                    "page_width": 1802,
                    "page_height": 2332,
                    "md":""
               }
           ]
       }
  }
}

// 失败的情况
{
    'code': 'parse_error', 'msg': '解析错误'
}

- 字段解释

含义
示例
data.progress
任务进度，0~100的整数
100
data.status
processing，failed，success
进行中，失败，成功
data.detail
status=failed时，报错的详细信息
解析失败，文件过大
result.pages
结果

page.url
本页url，如果本页存在小图片，则不为空，否则为空；
对于本页的小图，在page.md中以markdown引用格式给出
此图片会和 status 在同样的时间过期，请尽快通过 convert 导出到本地或者自行下载图片
<https://cdn.noedgeai.com/01927ab3-fcc8-72f3-8a0f-c1422afc9938_1.jpg>
page.page_idx
页id，从0开始

page.page_width/height
页宽/高，单位：像素点

page.md

本页的markdown格式文本

# Multispectral palmprint recognition based on three descriptors: LBP, Shift LBP, and Multi Shift LBP with LDA classifier

当失败时，请读取code中返回的状态码了解详细错误信息
错误代码
原因
解决方案
parse_task_limit_exceeded
任务数超限制
正在处理的任务数量达到上限, 等待先前提交的任务完成
parse_concurrency_limit
任务文件页数超限
正在处理的任务页数达到上限,等候先前提交的任务完成
parse_quota_limit
可用的解析页数额度不足
当前可用的页数不够
parse_error
解析错误
上传的 PDF 解析结果不正确
parse_create_task_error
创建任务失败
短暂等待后重试, 如果还出现报错则请联系负责人
parse_status_not_found
状态过期或uid错误
短暂等待后重试, 如果还出现报错则请联系负责人
parse_file_too_large
单个文件大小超过限制
当前允许单个文件大小 <= 300M, 请拆分 pdf
parse_page_limit_exceeded
单个文件页数超过限制
当前允许单个文件页数 <= 1000页, 请拆分 pdf
parse_file_lock
文件解析失败
为了防止反复解析, 暂时锁定一天
考虑PDF可能有兼容性问题, 重新打印后再尝试
仍然失败请反馈request_id给负责人
parse_file_not_pdf
传入的文件不是PDF文件
请解析后缀为.pdf的文件
POST /api/v2/convert/parse 请求导出文件（异步）
请求参数
名称
位置
类型
必选
说明
uid
body
json
是
解析任务的 id
to
body
json
是
导出格式，支持：md|tex|docx
formula_mode
body
json

是
导出模型，需填写：normal
当需要导出使用$$标记公式的md文件时改为：dollar
filename

body
json
否
导出后的md/tex文件名（不含后缀名），默认output.md/output.tex，仅对md和tex有效；
merge_cross_page_forms
body
bool
否
合并跨页表格
请求示例
curl --location --request POST '<https://v2.doc2x.noedgeai.com/api/v2/convert/parse>' \
--header 'Authorization: Bearer sk-xxx' \
--data-raw '{
    "uid": "01920000-0000-0000-0000-000000000000",
    "to": "md",
    "formula_mode": "normal",
    "filename": "my_markdown.md",
    "merge_cross_page_forms": "false"
}'
import requests
import json

url = "<https://v2.doc2x.noedgeai.com/api/v2/convert/parse>"
headers = {
    "Authorization": "Bearer sk-xxx",
    "Content-Type": "application/json",
}

data = {
    "uid": "01920000-0000-0000-0000-000000000000",
    "to": "md",
    "formula_mode": "normal",
    "filename": "my_markdown.md",
}

response = requests.post(url, headers=headers, data=json.dumps(data))

print(response.text)
返回示例
// 进行中
{
    "code": "success",
    "data": {
        "status": "processing",
        "url": ""
    }
}

- 说明：
status=processing时，表示正在处理中
- 注意：
  - 需要在headers里面添加 content-type 字段
    - "Content-Type": "application/json"
注意：接口/api/v2/convert/parse用于触发导出文件任务, 后续需使用/api/v2/convert/parse/result接口轮询导出任务状态, 请不要反复轮询/convert/parse接口
GET /api/v2/convert/parse/result 导出获取结果
请求参数
- 请求头
名称
描述
示例值
Authorization
Api key
Bearer REDACTED_API_KEY
- 请求体
名称
位置
类型
必选
说明
uid
query
string
是
异步任务的 id
请求示例
curl --location --request GET '<https://v2.doc2x.noedgeai.com/api/v2/convert/parse/result?uid=01920000-0000-0000-0000-000000000000>' \
--header 'Authorization: Bearer sk-xxx'
import requests

url = '<https://v2.doc2x.noedgeai.com/api/v2/convert/parse/result?uid=01920000-0000-0000-0000-000000000000>'
headers = {'Authorization': 'Bearer sk-xxx'}

response = requests.get(url, headers=headers)

print(response.text)
返回示例
{
    "code":"success",
    "data":{
        "status":"success",
        "url":"<https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/01927a3a-eeb0-74f6-a539-ca35916b772e5/convert_tex_none.zip?X-Amz-Algorithm=AWS4-HMACSHA256&X-Amz-Credential=REDACTED_AWS_ACCESS_KEY%2F20241011%2Fcn-north-1%2Fs3%2Faws4request&X-Amz-Date=20241011075617Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&&x-id=GetobjectX-Amz-Signature=REDACTED>"
    }
}
与 /api/v2/convert/parse 导出文件 返回结果相同，随后您需要使用其中的URL下载文件
从URL下载文件
从/api/v2/convert/parse/result或/api/v2/convert/parse接口获得形如下方示例的成功返回示例后，您可以使用HTTP GET方法请求url来下载文件：
部分场景下返回的 url 里面会把&用\\u0026表示，需要主动替换为&
{
    "code":"success",
    "data":{
        "status":"success",
        "url":"<https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/01927a3a-eeb0-74f6-a539-ca35916b772e5/convert_tex_none.zip?X-Amz-Algorithm=AWS4-HMACSHA256&X-Amz-Credential=REDACTED_AWS_ACCESS_KEY%2F20241011%2Fcn-north-1%2Fs3%2Faws4request&X-Amz-Date=20241011075617Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&&x-id=GetobjectX-Amz-Signature=REDACTED>"
    }
}
请求示例
curl -L -o downloaded_file.zip "<https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/01927a3a-eeb0-74f6-a539-ca35916b772e5/convert_tex_none.zip?X-Amz-Algorithm=AWS4-HMACSHA256&X-Amz-Credential=REDACTED_AWS_ACCESS_KEY%2F20241011%2Fcn-north-1%2Fs3%2Faws4request&X-Amz-Date=20241011075617Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&&x-id=GetobjectX-Amz-Signature=REDACTED>"
import requests

response = requests.get("<https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/01927a3a-eeb0-74f6-a539-ca35916b772e5/convert_tex_none.zip?X-Amz-Algorithm=AWS4-HMACSHA256&X-Amz-Credential=REDACTED_AWS_ACCESS_KEY%2F20241011%2Fcn-north-1%2Fs3%2Faws4request&X-Amz-Date=20241011075617Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&&x-id=GetobjectX-Amz-Signature=REDACTED>")

with open('downloaded_file.zip', 'wb') as f:
    f.write(response.content)
错误码

- 对应 httpcode 为429时，为超出API速率限制错误，等待先前提交的任务完成
- 对应 httpcode 均为200, 属于业务相关错误
错误代码
原因
解决方案
parse_task_limit_exceeded
任务数超限制
正在处理的任务数量达到上限, 等待先前提交的任务完成
parse_concurrency_limit
任务文件页数超限
正在处理的任务页数达到上限,等候先前提交的任务完成
parse_quota_limit
可用的解析页数额度不足
当前可用的页数不够
parse_error
解析错误
短暂等待后重试, 如果还出现报错则请联系负责人
parse_create_task_error
创建任务失败
短暂等待后重试, 如果还出现报错则请联系负责人
parse_status_not_found
状态过期或uid错误
短暂等待后重试, 如果还出现报错则请联系负责人
parse_file_too_large
单个文件大小超过限制
当前允许单个文件大小 <= 300M, 请拆分 pdf
parse_page_limit_exceeded
单个文件页数超过限制
当前允许单个文件页数 <= 2000页, 请拆分 pdf
parse_file_lock
文件解析失败
为了防止反复解析, 暂时锁定一天
考虑PDF可能有兼容性问题, 重新打印后再尝试
仍然失败请反馈request_id给负责人
parse_file_not_pdf
传入的文件不是PDF文件
请解析后缀为.pdf的文件
parse_file_invalid
解析文件错误或者不合法
我们无法解析这个pdf，一般是pdf格式有问题或者pdf不规范
parse_timeout

处理时间超过 15min
一般为内容过长导致的 15min 无法全部处理完，尝试切分 pdf 再识别
实用集成
封装的Python包 - pdfdeal
源码地址：<https://github.com/NoEdgeAI/pdfdeal-docs>
文档地址：<https://noedgeai.github.io/pdfdeal-docs/zh/guide/>
扣子插件 - 从URL识别PDF
插件地址：<https://www.coze.cn/store/plugin/7398010704374153253>
查看具体使用示例：扣子使用示例
FastGPT - Doc2X插件
使用FastGPT v4.8.14或更高版本
完整请求代码示范
<https://github.com/NoEdgeAI/doc2x-doc>
从V1异步接口迁移
文件上传(xxx/pdf接口)

- 请求参数不再提供ocr关闭选项，V2接口中默认开启ocr
- 请求参数不再提供pdf_url请求
- 响应结果应当由提取uuid改为提取uid
- 文件二进制数据位置更改为位于body
查看文件解析状态(xxx/status接口)
- 请求体应当提供uid而不是uuid
- 响应结果格式与V1保持一致
导出文件(xxx/export接口)
- 由同步接口改为异步接口，需要先请求/api/v2/convert/parse接口以开始文件导出任务，由/api/v2/convert/parse/result接口获知导出任务进度，详细流程请参见文章顶部文件导出UML图
