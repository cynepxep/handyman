-- «Повна оплата онлайн» на сайте выключена, пока онлайн-оплата не подключена (решение владельца 2026-09-28).
-- Меняются только сохранённые настройки оформления; включить обратно — галочка в «Сайт → Оформление заказа».
UPDATE "Setting"
SET "value" = jsonb_set("value", '{pay,full}', 'false'::jsonb, true)
WHERE "key" = 'shop.checkout' AND jsonb_typeof("value"->'pay') = 'object';
