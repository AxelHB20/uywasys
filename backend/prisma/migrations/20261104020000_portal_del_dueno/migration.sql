-- Portal del dueño: enlace sin contraseña (se guarda el hash del token)
CREATE TABLE "portal_links" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_viewed_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "portal_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_links_token_hash_key" ON "portal_links"("token_hash");
CREATE INDEX "portal_links_client_id_idx" ON "portal_links"("client_id");

ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
