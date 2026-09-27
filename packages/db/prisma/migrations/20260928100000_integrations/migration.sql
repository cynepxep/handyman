-- CreateTable
CREATE TABLE "IntegrationSecret" (
    "key" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("key")
);

