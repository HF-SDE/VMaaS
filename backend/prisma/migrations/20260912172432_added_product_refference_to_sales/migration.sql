-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "productId" UUID;

-- CreateIndex
CREATE INDEX "sales_productId_idx" ON "sales"("productId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
