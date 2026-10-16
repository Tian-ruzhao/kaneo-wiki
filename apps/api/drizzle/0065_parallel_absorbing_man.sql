ALTER TABLE "asset" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "asset_pageId_idx" ON "asset" USING btree ("page_id");