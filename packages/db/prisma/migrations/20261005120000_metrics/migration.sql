-- «Отчёты → Метрики»: счётчик посетителей, корзин и оформлений по дням (без cookies)
CREATE TABLE "MetricDay" (
    "day" DATE NOT NULL,
    "step" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MetricDay_pkey" PRIMARY KEY ("day","step","channel")
);

CREATE TABLE "MetricSeen" (
    "day" DATE NOT NULL,
    "step" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,

    CONSTRAINT "MetricSeen_pkey" PRIMARY KEY ("day","step","visitor")
);
