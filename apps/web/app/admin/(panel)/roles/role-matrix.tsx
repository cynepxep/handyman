"use client";

import { useTransition, type CSSProperties } from "react";
import type { Permission } from "@handyman/core";
import { togglePermission } from "./actions";

interface RoleRow {
  key: string;
  title: string;
  builtin: boolean;
  staffCount: number;
  permissions: Set<string>;
}

interface Props {
  roles: RoleRow[];
  permissions: Array<{ key: Permission; label: string }>;
}

export function RoleMatrix({ roles, permissions }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cellStyle}>Право</th>
            {roles.map((r) => (
              <th key={r.key} style={cellStyle}>
                {r.title}
                <div style={{ fontWeight: 400, fontSize: 12, color: "#888" }}>
                  сотрудников: {r.staffCount}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissions.map((perm) => (
            <tr key={perm.key}>
              <td style={cellStyle}>{perm.label}</td>
              {roles.map((role) => {
                const checked = role.key === "owner" ? true : role.permissions.has(perm.key);
                const disabled = role.key === "owner" || isPending;
                return (
                  <td style={{ ...cellStyle, textAlign: "center" }} key={role.key + perm.key}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = e.target.checked;
                        startTransition(() => {
                          void togglePermission(role.key, perm.key, next);
                        });
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cellStyle: CSSProperties = {
  border: "1px solid #ddd",
  padding: "6px 10px",
  fontSize: 14,
};
