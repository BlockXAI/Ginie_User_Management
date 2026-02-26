-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMP(6),
    "display_name" TEXT,
    "wallet_address" TEXT,
    "role" TEXT NOT NULL DEFAULT 'normal',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_hash" TEXT NOT NULL,
    "refresh_hash" TEXT,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "device_info" JSONB NOT NULL DEFAULT '{}',
    "ip" INET,
    "last_active_at" TIMESTAMP(6),
    "revoked_at" TIMESTAMP(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "user_id" UUID NOT NULL,
    "pro_enabled" BOOLEAN NOT NULL DEFAULT false,
    "wallet_deployments" BOOLEAN NOT NULL DEFAULT false,
    "history_export" BOOLEAN NOT NULL DEFAULT false,
    "chat_agents" BOOLEAN NOT NULL DEFAULT false,
    "hosted_frontend" BOOLEAN NOT NULL DEFAULT false,
    "limits" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "premium_keys" (
    "id" UUID NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "issued_by_admin" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "redeemed_by_user" UUID,
    "expires_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_jobs" (
    "job_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'pipeline',
    "prompt" TEXT,
    "filename" TEXT,
    "network" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_jobs_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "job_cache" (
    "job_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT,
    "fq_name" TEXT,
    "constructor_args" JSONB NOT NULL DEFAULT '[]',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "explorer_url" TEXT,
    "completed_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_cache_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "event" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_hash_key" ON "sessions"("session_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_hash_key" ON "sessions"("refresh_hash");

-- CreateIndex
CREATE INDEX "idx_premium_keys_status" ON "premium_keys"("status");

-- CreateIndex
CREATE INDEX "idx_premium_keys_expires_at" ON "premium_keys"("expires_at");

-- CreateIndex
CREATE INDEX "idx_user_jobs_user_created_at" ON "user_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_user_jobs_type_created_at" ON "user_jobs"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_job_cache_state" ON "job_cache"("state");

-- CreateIndex
CREATE INDEX "idx_job_cache_updated_at" ON "job_cache"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_event_created" ON "audit_logs"("event", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "premium_keys" ADD CONSTRAINT "premium_keys_issued_by_admin_fkey" FOREIGN KEY ("issued_by_admin") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "premium_keys" ADD CONSTRAINT "premium_keys_redeemed_by_user_fkey" FOREIGN KEY ("redeemed_by_user") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_jobs" ADD CONSTRAINT "user_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

