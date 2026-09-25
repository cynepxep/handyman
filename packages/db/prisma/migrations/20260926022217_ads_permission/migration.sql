-- Право «Реклама и баннеры» (ads.edit): владельцу и главному администратору, если такие роли есть. Только добавление.
INSERT INTO "RolePermission" ("roleKey", "permission")
SELECT r."key", 'ads.edit' FROM "Role" r WHERE r."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
