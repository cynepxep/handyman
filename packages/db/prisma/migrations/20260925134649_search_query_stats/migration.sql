-- CreateTable
CREATE TABLE "SearchQueryDay" (
    "day" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchQueryDay_pkey" PRIMARY KEY ("day","query")
);

-- CreateIndex
CREATE INDEX "SearchQueryDay_query_idx" ON "SearchQueryDay"("query");
