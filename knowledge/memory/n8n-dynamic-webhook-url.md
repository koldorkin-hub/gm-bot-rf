---
name: n8n-dynamic-webhook-url
description: В n8n путь вебхука с параметром (:param) резолвится только с webhookId первым сегментом URL
metadata: 
  node_type: memory
  type: reference
  originSessionId: 52640038-09b4-432e-9afb-c8158670a305
---

Если в узле Webhook путь содержит параметр — например `trainer/:bot_id` — то «красивый» URL вида `https://host/webhook/trainer/gymak` возвращает **404**. Проверено на n8n 2.27.4 по исходнику `dist/webhooks/webhook.service.js`:

```js
async findDynamicWebhook(path, method) {
  const [uuidSegment, ...otherSegments] = path.split('/');
  const dynamicWebhooks = await this.webhookRepository.findBy({
    webhookId: uuidSegment, method, pathLength: otherSegments.length });
```

Сначала ищется точное статическое совпадение пути, и только потом динамическое — причём первым сегментом обязан идти `webhookId` узла, а число остальных сегментов должно совпасть с `pathLength`. Рабочий адрес поэтому выглядит так:

```
https://n8n.exlogist.com/webhook/<webhookId>/trainer/<bot_id>
```

`webhookId` берётся из таблицы `webhook_entity` в `database.sqlite` (поля `webhookPath`, `pathLength`, `webhookId`) либо из поля `webhookId` узла в экспорте workflow. Для бота @GymAK_AI_Bot это `904e1298-08ed-4687-b7f7-3505bfb377b9`.

Практический вывод: адрес некрасивый, но виден только в вызове `setWebhook` и пользователям не показывается, так что городить обходные пути ради вида не стоит. Альтернатива, если когда-нибудь понадобится чистый URL — статический путь без параметра и определение клиента по заголовку `X-Telegram-Bot-Api-Secret-Token` (искать клиента в БД сразу по секрету, объединив идентификацию с аутентификацией).

Применение в проекте — см. [[n8n-multitenancy]].
