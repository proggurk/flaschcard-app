ALTER TABLE "cards" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "reviews_user_synced_at_idx" ON "reviews" USING btree ("user_id","synced_at");