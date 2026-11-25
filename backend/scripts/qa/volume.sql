-- QA de rendimiento: una clínica "Volumen QA" con ~3 años de una veterinaria mediana (~40 atenciones/día).
-- Solo para bases locales de prueba. Uso: psql $DATABASE_URL -f scripts/qa/volume.sql
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM clinics WHERE name = 'Volumen QA' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.clinic_id = clinics.id);
CREATE TEMP TABLE v AS
WITH c AS (INSERT INTO clinics (name, phone, updated_at) VALUES ('Volumen QA', '987000999', now()) RETURNING id) SELECT id AS clinic FROM c;
-- Contraseña: Demo2026clave (mismo hash que el usuario admin demo)
INSERT INTO users (clinic_id, full_name, email, role, password_hash, license_number, updated_at)
SELECT v.clinic, x.name, x.email || v.clinic || '@uywa.pe', x.role::"Role",
       (SELECT password_hash FROM users WHERE email = 'admin@huellitas.pe' LIMIT 1), x.lic, now()
FROM v, (VALUES ('Admin Volumen', 'qa-admin-', 'ADMIN', '10001'), ('Vet Volumen', 'qa-vet-', 'VET', '10002'),
                ('Recepción Volumen', 'qa-reception-', 'RECEPTION', NULL)) x(name, email, role, lic);
ALTER TABLE v ADD admin int, ADD vet int;
UPDATE v SET admin = (SELECT id FROM users WHERE email LIKE 'qa-admin-%' AND clinic_id = v.clinic),
             vet = (SELECT id FROM users WHERE email LIKE 'qa-vet-%' AND clinic_id = v.clinic);

INSERT INTO clients (clinic_id, number, name, phone, consent_at, consent_version, consent_channel, search_text, updated_at, doc_type, doc_number)
SELECT v.clinic, g, 'Cliente ' || g || ' ' || (ARRAY['Quispe','Mamani','Flores','Torres','Rojas','Huamán','Chávez','Ramos'])[1 + g % 8],
       '9' || lpad((10000000 + g)::text, 8, '0'), now() - (g % 1000) * interval '1 day', 'v2', 'FORM',
       lower('cliente ' || g || ' ' || (ARRAY['quispe','mamani','flores','torres','rojas','huaman','chavez','ramos'])[1 + g % 8] || ' ' || lpad((40000000 + g)::text, 8, '0') || ' 9' || lpad((10000000 + g)::text, 8, '0')),
       now(), 'DNI', lpad((40000000 + g)::text, 8, '0')
FROM v, generate_series(1, 8000) g;

INSERT INTO pets (clinic_id, client_id, number, name, name_search, species, updated_at)
SELECT v.clinic, c.id, row_number() OVER (), n.name, lower(n.name), (CASE WHEN c.number % 3 = 0 THEN 'CAT' ELSE 'DOG' END)::"Species", now()
FROM v JOIN clients c ON c.clinic_id = v.clinic
CROSS JOIN LATERAL (SELECT (ARRAY['Toby','Luna','Max','Rocky','Kira','Simba','Nala','Coco'])[1 + (c.number + k) % 8] || ' ' || k AS name
                    FROM generate_series(1, 1 + (c.number % 3 = 0)::int) k) n;

-- 45 000 atenciones en 3 años, cerradas, con su cola
CREATE TEMP TABLE vp AS SELECT p.id pet, p.client_id client, row_number() OVER (ORDER BY p.id) rn FROM pets p, v WHERE p.clinic_id = v.clinic;
INSERT INTO queue_entries (clinic_id, pet_id, day, created_by_id, updated_at, status, arrived_at)
SELECT v.clinic, vp.pet, (now() - (g % 1095) * interval '1 day')::date, v.admin, now(), 'DONE', now() - (g % 1095) * interval '1 day'
FROM v, generate_series(1, 45000) g JOIN vp ON vp.rn = 1 + g % (SELECT count(*) FROM vp);
INSERT INTO visits (clinic_id, pet_id, client_id, attended_by_id, updated_at, status, opened_at, closed_at, reason, queue_entry_id)
SELECT q.clinic_id, q.pet_id, vp.client, v.vet, now(), 'CLOSED', q.arrived_at, q.arrived_at + interval '20 min', 'Control', q.id
FROM queue_entries q JOIN v ON q.clinic_id = v.clinic JOIN vp ON vp.pet = q.pet_id;

-- 2 cargos por atención; caja con 1 sesión por día
INSERT INTO charges (clinic_id, client_id, visit_id, pet_id, kind, description, quantity, unit_price, igv_affectation, igv_rate, sunat_unit, taxable_amount, igv_amount, total, created_by_id, status, paid_amount, created_at)
SELECT vi.clinic_id, vi.client_id, vi.id, vi.pet_id, 'SERVICE', d.name, 1, d.price, 'TAXED', 0.18, 'ZZ', round(d.price / 1.18, 2), d.price - round(d.price / 1.18, 2), d.price, v.vet,
       CASE WHEN vi.id % 25 = 0 THEN 'PENDING' ELSE 'PAID' END::"ChargeStatus", CASE WHEN vi.id % 25 = 0 THEN 0 ELSE d.price END, vi.opened_at
FROM visits vi JOIN v ON vi.clinic_id = v.clinic, (VALUES ('Consulta general', 60.00), ('Antiparasitario', 35.00)) d(name, price);
INSERT INTO cash_registers (clinic_id, name) SELECT v.clinic, 'Caja QA' FROM v ON CONFLICT DO NOTHING;
INSERT INTO cash_sessions (clinic_id, register_id, opening_amount, opened_by_id, opened_at, closed_at, status)
SELECT v.clinic, (SELECT id FROM cash_registers WHERE clinic_id = v.clinic LIMIT 1), 100, v.admin, d, d + interval '10 hours', 'CLOSED'
FROM v, generate_series(now() - interval '1096 days', now(), interval '1 day') d;
INSERT INTO receipts (clinic_id, number, client_id, session_id, total, request_key, created_by_id, created_at)
SELECT vi.clinic_id, row_number() OVER (ORDER BY vi.id), vi.client_id,
       (SELECT s.id FROM cash_sessions s WHERE s.clinic_id = vi.clinic_id AND s.opened_at <= vi.opened_at ORDER BY s.opened_at DESC LIMIT 1),
       95, 'qa-' || vi.id, v.admin, vi.opened_at + interval '25 min'
FROM visits vi JOIN v ON vi.clinic_id = v.clinic WHERE vi.id % 25 <> 0;
DELETE FROM receipts r USING v WHERE r.clinic_id = v.clinic AND r.session_id IS NULL;
INSERT INTO payments (clinic_id, receipt_id, method, amount)
SELECT r.clinic_id, r.id, (ARRAY['CASH','YAPE','PLIN','CARD'])[1 + r.id % 4]::"PaymentMethod", r.total FROM receipts r JOIN v ON r.clinic_id = v.clinic;
INSERT INTO payment_allocations (receipt_id, charge_id, amount)
SELECT r.id, ch.id, ch.total FROM receipts r JOIN v ON r.clinic_id = v.clinic
JOIN visits vi ON 'qa-' || vi.id = r.request_key JOIN charges ch ON ch.visit_id = vi.id;
INSERT INTO electronic_documents (clinic_id, receipt_id, type, series, number, issue_date, customer_doc_type, customer_doc_number, customer_name, taxed_amount, exempt_amount, unaffected_amount, igv_amount, total, items, provider, created_by_id, updated_at, status, created_at)
SELECT r.clinic_id, r.id, 'BOLETA', 'B001', row_number() OVER (ORDER BY r.id), r.created_at::date, '1', c.doc_number, c.name, 80.51, 0, 0, 14.49, 95, '[]', 'SIMULATED', v.admin, now(), 'ACCEPTED', r.created_at
FROM receipts r JOIN v ON r.clinic_id = v.clinic JOIN clients c ON c.id = r.client_id;

-- Citas (pasadas y próximas), vacunas y recetas
INSERT INTO appointments (clinic_id, pet_id, client_id, vet_id, starts_at, created_by_id, updated_at, status, reason)
SELECT v.clinic, vp.pet, vp.client, v.vet, date_trunc('hour', now()) + ((g % 1200) - 1095) * interval '1 day' + (9 + g % 9) * interval '1 hour',
       v.admin, now(), (CASE WHEN g % 1200 < 1095 THEN 'ARRIVED' ELSE 'SCHEDULED' END)::"AppointmentStatus", 'Control'
FROM v, generate_series(1, 20000) g JOIN vp ON vp.rn = 1 + (g * 7) % (SELECT count(*) FROM vp);
INSERT INTO immunizations (clinic_id, pet_id, kind, name, applied_at, next_due_at, applied_by_id)
SELECT v.clinic, vp.pet, 'VACCINE', (ARRAY['Séxtuple','Antirrábica','Triple felina'])[1 + g % 3], (now() - (g % 1095) * interval '1 day')::date,
       (now() - (g % 1095) * interval '1 day' + interval '1 year')::date, v.vet
FROM v, generate_series(1, 30000) g JOIN vp ON vp.rn = 1 + (g * 13) % (SELECT count(*) FROM vp);
INSERT INTO prescriptions (clinic_id, number, visit_id, pet_id, client_id, vet_id, created_at)
SELECT vi.clinic_id, row_number() OVER (ORDER BY vi.id), vi.id, vi.pet_id, vi.client_id, v.vet, vi.opened_at
FROM visits vi JOIN v ON vi.clinic_id = v.clinic WHERE vi.id % 4 = 0;
INSERT INTO prescription_items (prescription_id, position, drug, dose, frequency, duration)
SELECT p.id, k, (ARRAY['Meloxicam 1 mg','Amoxicilina 250 mg'])[k], '1 tableta', 'Cada 12 horas', '5 días'
FROM prescriptions p JOIN v ON p.clinic_id = v.clinic, generate_series(1, 2) k;

-- Bitácora: ~7 acciones por atención
INSERT INTO audit_logs (clinic_id, user_id, action, entity, entity_id, created_at)
SELECT v.clinic, v.admin, (ARRAY['visit.open','charge.create','receipt.create','visit.close','auth.login','client.update','pet.update'])[1 + g % 7], 'Visit', g,
       now() - (g % 1095) * interval '1 day'
FROM v, generate_series(1, 315000) g;

-- Secuencias para que la clínica pueda seguir operando
INSERT INTO clinic_sequences (clinic_id, key, last_value)
SELECT v.clinic, k, n FROM v, (VALUES ('client', 8000), ('pet', 11000), ('receipt', 50000), ('prescription', 20000), ('boleta:B001', 50000)) s(k, n)
ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE;
SELECT (SELECT clinic FROM v) AS clinic, (SELECT count(*) FROM visits vi JOIN v ON vi.clinic_id = v.clinic) AS visitas;
