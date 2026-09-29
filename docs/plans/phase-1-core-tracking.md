# Deal Hunter — Project Plan

## 1. Product Overview

**Deal Hunter** là công cụ săn deal xuyên các nền tảng TMĐT, tập trung vào:

- Theo dõi giá sản phẩm.
- Lưu lịch sử giá.
- Tính giá thực tế (effective price).
- Phát hiện biến động giá.
- Về sau hỗ trợ cảnh báo theo điều kiện và gửi Zalo.
- Về sau mở rộng sang Shopee, Lazada, TikTok Shop và matching sản phẩm xuyên sàn.

### Product philosophy

Không xây một "scraper app".

Marketplace chỉ là **data provider**. Core product là:

```text
Product
   ↓
Tracking
   ↓
Scheduled Fetch
   ↓
Price Snapshot
   ↓
Price Event
   ↓
Rule Engine
   ↓
Notification
```

---

# 2. Mục tiêu Phase 1

Phase 1 là một **vertical slice end-to-end**.

User có thể:

```text
Dán link sản phẩm
      ↓
Nhận diện platform
      ↓
Lấy thông tin sản phẩm + giá
      ↓
Lưu sản phẩm
      ↓
Tự động refresh giá định kỳ
      ↓
Lưu price history
      ↓
Xem giá hiện tại + lịch sử
```

## Phase 1 KHÔNG làm

- Zalo notification.
- Alert rule engine.
- Cross-platform product matching.
- Search toàn sàn.
- Auto Hunt.
- Deal Score.
- Fake discount detection.
- LLM/AI.
- Mobile app.
- Distributed crawling ở quy mô lớn.

Nhưng kiến trúc phải để các phần trên cắm thêm được mà không rewrite core.

---

# 3. Tech Stack

```text
Backend
    Go

HTTP
    net/http + router nhẹ

Database
    PostgreSQL

Queue
    Redis Streams

Workers
    Go goroutines + worker pool

Scheduler
    Go + PostgreSQL

Frontend
    React/Next.js hoặc frontend đơn giản

Local infrastructure
    Docker Compose

Testing
    go test
    httptest
    integration tests
```

Không thêm Kafka/RabbitMQ/Kubernetes/Elasticsearch/ClickHouse ở Phase 1.

---

# 4. Architecture

```text
                    ┌──────────────────────┐
                    │       Browser        │
                    └──────────┬───────────┘
                               │ HTTP
                               ▼
                    ┌──────────────────────┐
                    │       Go API         │
                    │                      │
                    │ Product / Tracking   │
                    │ Price History        │
                    └──────┬───────┬───────┘
                           │        │
                    PostgreSQL     Redis
                           │        │
                           │        │ Stream
                           │        ▼
                           │   ┌──────────────┐
                           │   │ Worker Queue │
                           │   └──────┬───────┘
                           │          │
                           │          ▼
                           │   ┌──────────────┐
                           │   │ Go Workers   │
                           │   └──────┬───────┘
                           │          │
                           │          ▼
                           │   Marketplace Adapter
                           │
                           └──────────────────
```

## Responsibility

### PostgreSQL

Source of truth:

- User.
- Product.
- Product source.
- Tracking.
- Price history.
- Fetch jobs.
- Scheduler state.
- Job retry state.

### Redis

Không phải database nghiệp vụ.

Dùng cho:

- Redis Streams.
- Worker queue.
- Consumer groups.
- Sau này: cache.
- Sau này: distributed lock.
- Sau này: rate limiting.

### Go API

- Nhận HTTP requests.
- Validate input.
- Gọi domain services.
- Không trực tiếp chạy crawling dài.

### Scheduler

- Tìm tracking đã đến hạn.
- Tạo fetch job.
- Đẩy job vào Redis Stream.

### Worker

- Consume fetch job.
- Gọi marketplace adapter.
- Lưu price snapshot.
- Update current price.
- Schedule lần fetch tiếp theo.
- Retry lỗi phù hợp.

---

# 5. PostgreSQL Data Model

## 5.1 users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Phase 1 có thể dùng anonymous user. Login/email/OAuth để sau.

---

## 5.2 products

Đại diện cho **logical product**.

```sql
CREATE TABLE products (
    id UUID PRIMARY KEY,

    title TEXT NOT NULL,

    brand TEXT,
    model TEXT,
    variant TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Ví dụ:

```text
Sony WH-1000XM6
brand  = Sony
model  = WH-1000XM6
variant = Black
```

Phase 1 chưa giải quyết matching sản phẩm giữa nhiều sàn.

---

## 5.3 product_sources

Đây là nguồn sản phẩm trên marketplace.

Một logical product có thể về sau có:

```text
products
   ├── Shopee source
   ├── Lazada source
   └── TikTok source
```

Schema:

```sql
CREATE TABLE product_sources (
    id UUID PRIMARY KEY,

    product_id UUID NOT NULL
        REFERENCES products(id),

    platform VARCHAR(32) NOT NULL,

    external_product_id TEXT,

    canonical_url TEXT NOT NULL,

    seller_name TEXT,

    raw_title TEXT,

    currency CHAR(3) NOT NULL DEFAULT 'VND',

    last_price BIGINT,
    last_shipping_fee BIGINT,
    last_effective_price BIGINT,

    last_in_stock BOOLEAN,
    last_fetched_at TIMESTAMPTZ,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(platform, external_product_id)
);
```

### Design note

`last_*` là current state để đọc nhanh.

`price_snapshots` là historical source.

Đây là intentional denormalization.

---

## 5.4 tracked_products

User đang theo dõi sản phẩm nào.

```sql
CREATE TABLE tracked_products (
    id UUID PRIMARY KEY,

    user_id UUID NOT NULL
        REFERENCES users(id),

    product_source_id UUID NOT NULL
        REFERENCES product_sources(id),

    active BOOLEAN NOT NULL DEFAULT TRUE,

    polling_interval_seconds INT NOT NULL DEFAULT 1800,

    next_fetch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, product_source_id)
);
```

Phase 1 có thể cố định `polling_interval_seconds = 1800` (30 phút), chưa cần cho user customize.

---

## 5.5 price_snapshots

Trái tim của price tracking.

```sql
CREATE TABLE price_snapshots (
    id BIGSERIAL PRIMARY KEY,

    product_source_id UUID NOT NULL
        REFERENCES product_sources(id),

    price BIGINT NOT NULL,

    shipping_fee BIGINT NOT NULL DEFAULT 0,

    effective_price BIGINT NOT NULL,

    currency CHAR(3) NOT NULL DEFAULT 'VND',

    in_stock BOOLEAN,

    captured_at TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Ví dụ:

```text
10:00 → 2,000,000
10:30 → 2,000,000
11:00 → 1,950,000
11:30 → 1,950,000
12:00 → 1,890,000
```

Phase 1 lưu snapshot mỗi lần fetch thành công.

---

## 5.6 fetch_jobs

Redis chỉ transport job. PostgreSQL lưu state.

```sql
CREATE TABLE fetch_jobs (
    id UUID PRIMARY KEY,

    product_source_id UUID NOT NULL
        REFERENCES product_sources(id),

    status VARCHAR(32) NOT NULL,

    attempt INT NOT NULL DEFAULT 0,

    available_at TIMESTAMPTZ NOT NULL,

    picked_at TIMESTAMPTZ,

    finished_at TIMESTAMPTZ,

    error_code TEXT,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

State:

```text
queued
running
succeeded
failed
dead
```

---

# 6. PostgreSQL Indexes

## Scheduler

```sql
CREATE INDEX idx_tracked_products_due
ON tracked_products(next_fetch_at)
WHERE active = TRUE;
```

## Price history

```sql
CREATE INDEX idx_price_snapshots_product_time
ON price_snapshots(product_source_id, captured_at DESC);
```

## Jobs

```sql
CREATE INDEX idx_fetch_jobs_available
ON fetch_jobs(status, available_at);
```

Không index tất cả columns ngay từ đầu.

---

# 7. Effective Price

Không hard-code sale price.

Domain model:

```go
type Price struct {
    ListedPrice    int64
    SalePrice      int64
    ShopDiscount   int64
    PlatformCoupon int64
    ShippingFee    int64
}
```

Tính giá thực tế:

```go
func (p Price) EffectivePrice() int64 {
    base := p.SalePrice

    if base == 0 {
        base = p.ListedPrice
    }

    return base -
        p.ShopDiscount -
        p.PlatformCoupon +
        p.ShippingFee
}
```

Phase 1 có thể chỉ support:

```text
sale price
shipping
```

Nhưng model phải sẵn sàng cho voucher/coupon về sau.

---

# 8. Marketplace Adapter

Không rải:

```go
if platform == "shopee" { ... }
else if platform == "lazada" { ... }
```

khắp codebase.

Dùng interface:

```go
type Marketplace interface {
    Name() string

    ResolveProduct(
        ctx context.Context,
        url string,
    ) (*ProductData, error)

    FetchPrice(
        ctx context.Context,
        source ProductSource,
    ) (*PriceSnapshot, error)
}
```

Folder:

```text
internal/marketplace/
├── marketplace.go
├── registry.go
├── shopee/
│   └── adapter.go
├── lazada/
│   └── adapter.go
└── tiktok/
    └── adapter.go
```

### Phase 1

- Marketplace interface.
- Registry.
- 1 adapter thực tế.
- Mock adapter cho testing.
- Lazada/TikTok/Shopee còn lại để phase sau tùy khả năng dữ liệu/API.

Marketplace adapter chỉ chịu trách nhiệm lấy/normalize data từ platform.

Core business logic không phụ thuộc platform cụ thể.

---

# 9. URL Ingestion Flow

Request:

```http
POST /api/v1/tracked-products
```

Body:

```json
{
  "url": "https://..."
}
```

Flow:

```text
URL
 ↓
Normalize URL
 ↓
Detect Platform
 ↓
Marketplace Adapter
 ↓
Resolve Product
 ↓
Upsert Product
 ↓
Upsert ProductSource
 ↓
Create Tracking
 ↓
Create FetchJob
 ↓
Return product
```

Response mẫu:

```json
{
  "id": "tracking-id",
  "product": {
    "title": "Sony WH-1000XM6",
    "platform": "shopee",
    "current_price": 6290000
  }
}
```

---

# 10. Redis Streams

Stream:

```text
dh:stream:price-fetch
```

Consumer group:

```text
price-workers
```

Workers:

```text
worker-01
worker-02
worker-03
worker-04
```

Message tối thiểu:

```json
{
  "job_id": "..."
}
```

Redis Streams hỗ trợ consumer groups, acknowledgement và xử lý lại message chưa ACK. Vì vậy worker bắt buộc phải idempotent.

---

# 11. Worker Flow

```text
XREADGROUP
    ↓
job_id
    ↓
Load fetch_job from PostgreSQL
    ↓
Mark RUNNING
    ↓
Load product_source
    ↓
Find marketplace adapter
    ↓
FetchPrice(ctx)
    ↓
Success?
 ┌───────────────┐
 │      YES      │
 └───────┬───────┘
         ↓
Insert snapshot
         ↓
Update current price
         ↓
Update fetch job
         ↓
Schedule next fetch
         ↓
XACK
```

---

# 12. Retry Strategy

## Retryable

```text
timeout
network error
429
5xx
temporary dependency failure
```

## Non-retryable

```text
invalid URL
unsupported platform
product deleted
permanent parse failure
```

Backoff ví dụ:

```text
attempt 1 → 1 minute
attempt 2 → 5 minutes
attempt 3 → 15 minutes
attempt 4 → 1 hour
```

Sau N lần:

```text
dead
```

Không retry vô hạn.

---

# 13. Idempotency

Scenario:

```text
Worker fetch
    ↓
DB commit
    ↓
CRASH
    ↓
XACK chưa chạy
    ↓
Redis redeliver
```

Job có thể được xử lý lại.

Do đó cần đảm bảo:

```text
same job replay
    ≠
duplicate business effect
```

Có thể quản lý bằng job state/idempotency key và constraint phù hợp trong database.

Nên có test riêng cho case worker crash trước ACK.

---

# 14. Transaction khi fetch thành công

Khi fetch thành công:

```text
BEGIN

INSERT price_snapshot

UPDATE product_sources
SET
    last_price = ...,
    last_effective_price = ...,
    last_fetched_at = ...,
    last_in_stock = ...

UPDATE fetch_jobs
SET status = 'succeeded'

UPDATE tracked_products
SET next_fetch_at = ...

COMMIT
```

Nếu lỗi giữa chừng:

```text
ROLLBACK
```

Mục tiêu là không có trạng thái:

```text
snapshot có
nhưng current price không update
```

---

# 15. Scheduler

Scheduler chạy định kỳ, ví dụ mỗi 10 giây.

Query:

```sql
SELECT ...
FROM tracked_products
WHERE active = true
  AND next_fetch_at <= NOW()
ORDER BY next_fetch_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Flow:

```text
Scheduler
   ↓
Claim due tracking
   ↓
Create fetch_job
   ↓
XADD Redis Stream
   ↓
Update next_fetch_at
```

Sau này có thể chạy nhiều scheduler mà không tranh cùng row nhờ `SKIP LOCKED`.

---

# 16. Go Concurrency

Worker pool:

```text
Redis
 ↓
Dispatcher
 ↓
┌─────┬─────┬─────┬─────┬─────┐
W1    W2    W3    W4    W5
│     │     │     │     │
API   API   API   API   API
```

Config:

```env
WORKER_CONCURRENCY=10
```

Benchmark:

```text
1 worker
5 workers
10 workers
20 workers
50 workers
```

Measure:

```text
jobs/sec
p50 latency
p95 latency
CPU
memory
error rate
```

---

# 17. Context

External operation phải nhận context:

```go
func (a *Adapter) FetchPrice(
    ctx context.Context,
    source ProductSource,
) (*PriceSnapshot, error)
```

Timeout:

```go
ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
defer cancel()
```

Flow cancellation:

```text
HTTP / Worker
     ↓
Context
     ↓
Adapter
     ↓
HTTP call / DB call
```

---

# 18. Redis Keys

Phase 1:

```text
stream:
dh:stream:price-fetch

consumer group:
price-workers

optional cache:
dh:product:{id}

optional lock:
dh:lock:fetch:{product_source_id}
```

Không lưu business state quan trọng chỉ trong Redis.

Nếu Redis chết, PostgreSQL vẫn phải biết:

```text
user đang track gì
current price là gì
next fetch lúc nào
job state là gì
```

---

# 19. API Phase 1

## Add tracking

```http
POST /api/v1/tracked-products
```

## List tracking

```http
GET /api/v1/tracked-products
```

## Detail

```http
GET /api/v1/tracked-products/:id
```

## Price history

```http
GET /api/v1/tracked-products/:id/prices
```

Query:

```text
?from=2026-09-01
&to=2026-09-23
```

## Pause

```http
POST /api/v1/tracked-products/:id/pause
```

## Resume

```http
POST /api/v1/tracked-products/:id/resume
```

Chưa có alert API trong Phase 1.

---

# 20. Frontend Phase 1

Chỉ cần 4 màn.

## Home

```text
┌─────────────────────────────────────┐
│ Paste product URL                   │
│ [_____________________________]     │
│              [ Track ]              │
└─────────────────────────────────────┘
```

## My Tracking

Ví dụ:

```text
Sony XM6
6,290,000đ
↓ 8.7% vs first tracked price
Last checked 10 min ago
```

## Product Detail

```text
Sony WH-1000XM6

Current
6,290,000đ

Price History
```

Có biểu đồ:

```text
7,000k ┤
6,800k ┤      ●
6,600k ┤ ●
6,400k ┤          ●
6,200k ┤               ●
       └────────────────────
         Sep Sep Sep Sep
```

## Settings

Phase 1 chỉ cần:

```text
Polling interval
30m / 1h / 6h
```

Có thể hard-code 30m trước rồi mới mở UI.

---

# 21. Logging

Structured logging.

Ví dụ:

```json
{
  "level": "INFO",
  "event": "price_fetch_succeeded",
  "job_id": "...",
  "product_source_id": "...",
  "platform": "shopee",
  "latency_ms": 843,
  "effective_price": 6290000
}
```

Không log:

```text
cookies
tokens
private headers
personal data
```

---

# 22. Metrics

Phase 1 nên có:

```text
price_fetch_total
price_fetch_success_total
price_fetch_failure_total

price_fetch_duration_seconds

queue_depth

job_retry_total

active_tracked_products

price_snapshots_total
```

Đặc biệt cần:

```text
fetch success rate
median fetch latency
p95 fetch latency
```

---

# 23. Testing Strategy

## Unit tests

Test:

```text
URL → platform detection
Price → effective price
Scheduler → next_fetch_at
Retry → backoff
```

## Adapter tests

Dùng:

```go
httptest.Server
```

để mock marketplace response.

## Integration test

Flow:

```text
create tracking
    ↓
scheduler
    ↓
create job
    ↓
Redis
    ↓
worker
    ↓
mock marketplace
    ↓
price snapshot
    ↓
current price update
```

## Crash/re-delivery test

```text
process job
    ↓
DB commit
    ↓
crash before XACK
    ↓
message redelivered
    ↓
no duplicate logical effect
```

---

# 24. Docker Compose

Phase 1:

```text
docker compose
├── postgres
├── redis
├── api
├── worker
└── scheduler
```

Local dev có thể chạy API/worker/scheduler ngoài Docker, nhưng production-like compose nên tách 3 process.

---

# 25. Configuration

```env
APP_ENV=development

HTTP_PORT=8080

DATABASE_URL=postgres://...

REDIS_URL=redis://...

WORKER_CONCURRENCY=10

DEFAULT_POLL_INTERVAL=1800

FETCH_TIMEOUT=10s

MAX_RETRY=5
```

Không hard-code credentials/config.

---

# 26. Go Project Structure

```text
deal-hunter/
│
├── cmd/
│   ├── api/
│   │   └── main.go
│   │
│   ├── worker/
│   │   └── main.go
│   │
│   ├── scheduler/
│   │   └── main.go
│   │
│   └── migrate/
│       └── main.go
│
├── internal/
│   ├── product/
│   │   ├── model.go
│   │   ├── service.go
│   │   └── repository.go
│   │
│   ├── tracking/
│   │   ├── model.go
│   │   ├── service.go
│   │   └── repository.go
│   │
│   ├── pricing/
│   │   ├── model.go
│   │   └── service.go
│   │
│   ├── marketplace/
│   │   ├── marketplace.go
│   │   ├── registry.go
│   │   └── shopee/
│   │       └── adapter.go
│   │
│   ├── jobs/
│   │   ├── model.go
│   │   ├── scheduler.go
│   │   └── worker.go
│   │
│   ├── queue/
│   │   ├── queue.go
│   │   └── redis_stream.go
│   │
│   └── http/
│       ├── handler.go
│       ├── middleware.go
│       └── router.go
│
├── migrations/
├── pkg/
├── docker-compose.yml
├── Makefile
├── README.md
└── go.mod
```

Không cần tạo hàng loạt interface nếu domain chưa cần. Interface nên nằm ở nơi abstraction thực sự có ích.

---

# 27. Phase 1 Definition of Done

Phase 1 hoàn thành khi flow này hoạt động:

```text
User
 ↓
Paste product URL
 ↓
POST /tracked-products
 ↓
Product created
 ↓
ProductSource created
 ↓
Tracking created
 ↓
Scheduler notices due task
 ↓
FetchJob created
 ↓
Redis Stream
 ↓
Worker consumes
 ↓
Marketplace adapter fetches
 ↓
Price snapshot inserted
 ↓
Current price updated
 ↓
Next fetch scheduled
 ↓
Fetch again
 ↓
History grows
 ↓
Frontend displays graph
```

Ngoài ra phải xử lý được:

```text
Marketplace timeout
    ↓
retry
    ↓
backoff
    ↓
success
```

và:

```text
Worker crash
    ↓
message pending
    ↓
message reclaimed/re-delivered
    ↓
worker xử lý lại
    ↓
không tạo business effect sai
```

---

# 28. Roadmap

## Phase 1 — Core Price Tracking

```text
[x] Project skeleton
[x] PostgreSQL schema
[x] Product
[x] ProductSource
[x] Tracking
[x] PriceSnapshot
[x] FetchJob
[x] Marketplace interface
[x] 1 marketplace adapter
[x] Redis Stream
[x] Worker pool
[x] Scheduler
[x] Retry
[x] Idempotency
[x] Price history API
[x] Basic frontend
[x] Tests
[x] Metrics/logging
```

Thực tế các `[x]` trên nghĩa là **scope đã chốt**, không phải đã implement.

## Phase 2 — Alert Engine + Zalo

```text
[ ] Price change event
[ ] Alert rule model
[ ] Rule evaluation engine
[ ] "giảm >= X%"
[ ] "giá <= X"
[ ] "lowest in N days"
[ ] Alert expiration
[ ] Dedup notification
[ ] Debounce notification
[ ] Zalo connection
[ ] Zalo template integration
[ ] Zalo notification worker
```

Target flow:

```text
Price Snapshot
      ↓
Price Change Event
      ↓
Rule Engine
      ↓
Rule matched?
      ↓ YES
Notification Queue
      ↓
Zalo
```

## Phase 3 — Multi-marketplace

```text
[ ] Shopee adapter
[ ] Lazada adapter
[ ] TikTok adapter
[ ] Source normalization
[ ] Product identity matching
[ ] Cross-platform comparison
[ ] Effective price normalization
```

## Phase 4 — Price Intelligence

```text
[ ] 24h / 7d / 30d / 90d / 180d metrics
[ ] Historical median
[ ] Historical minimum
[ ] Price volatility
[ ] Anomaly detection
[ ] Fake discount detection
[ ] Deal Score
[ ] Explainable deal signals
```

## Phase 5 — Auto Hunt

```text
[ ] Search across marketplaces
[ ] Follow keyword
[ ] Follow category
[ ] Budget constraints
[ ] Auto discovery
[ ] Deal feed
[ ] Personalized hunt
```

## Phase 6 — Scale

```text
[ ] Distributed workers
[ ] Adaptive polling
[ ] Per-platform rate limiting
[ ] Horizontal scaling
[ ] More advanced observability
[ ] Partitioning / retention strategy
[ ] Large-scale historical data
```

---

# 29. Future Product Features — IDEA NOTE

Các ý tưởng dưới đây **chưa thuộc Phase 1**.

## A. Cross-platform matching

```text
Shopee listing
Lazada listing
TikTok listing
        ↓
Product Identity Engine
        ↓
Same logical product?
```

Có thể dùng:

- title normalization
- tokenization
- Jaccard similarity
- edit distance
- TF-IDF
- MinHash/LSH
- weighted attribute matching
- model/variant extraction

Không dùng LLM.

---

## B. Fake Discount Detection

Phát hiện:

```text
Giá 3.5m
↓
3 ngày sau
↓
5m
↓
"SALE"
↓
3.5m
```

Metrics:

```text
historical median
historical percentile
minimum verified price
price volatility
change points
```

---

## C. Deal Score

Ví dụ:

```text
Historical discount
Cross-platform discount
Current price rank
Price stability
Seller quality
Stock signal
Recency
```

Score phải explainable.

Ví dụ:

```text
GOOD DEAL

- 13% thấp hơn median 90 ngày
- gần mức giá thấp nhất lịch sử
- rẻ hơn 2 sàn khác trung bình 9%
```

---

## D. Buy Now / Wait

User:

```text
"Tôi cần mua laptop trong 3 tháng."
```

Engine dùng:

- price history
- price cycles
- seasonality
- uncertainty
- optimal stopping

Output dạng:

```text
BUY NOW
WAIT
```

kèm dữ liệu giải thích chứ không phụ thuộc LLM.

---

## E. User Auto Hunt

User:

```text
ASUS ROG
RTX 5070
Budget < 45m
```

Engine:

```text
Search
 ↓
Normalize
 ↓
Match
 ↓
Price analysis
 ↓
Deal detection
 ↓
Alert
```

---

# 30. Data Acquisition Principles

Đây là một rủi ro kỹ thuật lớn.

Không được mặc định rằng cả Shopee/Lazada/TikTok đều có public consumer catalog API unrestricted.

Mỗi platform có thể khác nhau về:

```text
API availability
authentication
seller authorization
rate limits
anti-bot
HTML structure
product identifiers
voucher semantics
```

Do đó:

### Rule

**Marketplace Adapter phải cô lập data acquisition.**

Core không được biết:

```text
Shopee HTML
Lazada API
TikTok response
```

Core chỉ biết:

```text
ProductData
PriceSnapshot
Marketplace
```

Không xây foundation của sản phẩm dựa trên reverse-engineered private API.

Nếu dùng page crawling/ingestion phải kiểm tra:

```text
Terms of Service
robots policy
rate limits
legal/compliance requirements
```

---

# 31. Target End State

```text
                         DEAL HUNTER
                              │
             ┌────────────────┼────────────────┐
             ↓                ↓                ↓
        Discovery       Price Engine      Alert Engine
             │                │                │
             ↓                ↓                ↓
        Marketplace       Historical        User Rules
         Adapters          Analytics              │
             │                │                   ↓
             └────────────────┼────────────── Zalo
                              ↓
                     Product Intelligence
                              ↓
                      Cross-platform Data
```

Core technical stack:

```text
Go
 ├── API
 ├── Worker Pool
 ├── Scheduler
 ├── Marketplace Adapters
 ├── Event Processing
 └── Rule Engine

PostgreSQL
 ├── Business state
 ├── Product data
 ├── Tracking
 ├── Price history
 └── Job state

Redis
 ├── Streams
 ├── Consumer groups
 ├── Cache later
 ├── Locks later
 └── Rate limiting later
```

---

# 32. Phase 1 Implementation Order

Thứ tự code đề xuất:

```text
01. Repository initialization
02. Docker Compose
03. PostgreSQL connection
04. Migrations
05. Domain models
06. Repositories
07. Marketplace interface
08. Mock marketplace adapter
09. First real marketplace adapter
10. Tracking service
11. POST /tracked-products
12. Price snapshot service
13. Redis Streams abstraction
14. Worker
15. Scheduler
16. Retry/backoff
17. Idempotency
18. Price history endpoint
19. Basic frontend
20. Integration tests
21. Metrics
22. Structured logging
23. Failure/crash tests
24. README + architecture docs
```

---

# 33. Phase 1 Success Metrics

Không chỉ "API chạy".

Nên benchmark và kiểm tra:

```text
Tracking creation latency
Price fetch latency
Worker throughput
Queue depth under load
PostgreSQL query latency
Redis processing latency
Fetch success rate
Retry rate
Memory per worker
CPU per worker
```

Ví dụ target thử nghiệm:

```text
10 concurrent workers
100 tracked products
fetch interval = 30 min
```

Sau đó tăng:

```text
1,000 products
10,000 products
100,000 products
```

Mục tiêu Phase 1 không phải support production-scale 100k ngay, mà tạo baseline để biết bottleneck nằm ở:

```text
DB
Redis
Worker
Marketplace
Network
Scheduler
```

---

# 34. Core Design Principles

1. **PostgreSQL = source of truth.**

2. **Redis = queue/transport, không phải business database.**

3. **Marketplace-specific logic chỉ nằm trong adapter.**

4. **Worker phải idempotent.**

5. **Mọi external I/O dùng context + timeout.**

6. **Business state update quan trọng phải transactional.**

7. **Không over-engineer infrastructure trước khi có bottleneck thật.**

8. **Price model phải support effective price từ đầu.**

9. **Phase 1 ưu tiên vertical slice chạy thật hơn feature count.**

10. **Mọi Phase sau phải cắm vào event/pipeline hiện tại, không rewrite core.**
