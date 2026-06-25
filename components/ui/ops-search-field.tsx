"use client";

import { Search } from "lucide-react";

export function OpsSearchField({
  label,
  placeholder,
  value,
  onChange,
  iconSize = 16,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  iconSize?: number;
}) {
  return (
    <label className="search-box">
      <Search size={iconSize} />
      <span className="sr-only">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
