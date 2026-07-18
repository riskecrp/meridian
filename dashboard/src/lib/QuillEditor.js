"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const ReactQuill = dynamic(() => import("react-quill-new"), {
  ssr: false,
  loading: () => (
    <div style={{
      height: 300, display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8,
      color: "var(--fg-4)", fontSize: 13,
    }}>
      Loading editor...
    </div>
  ),
});

const MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["blockquote", "code-block"],
    ["link"],
    ["clean"],
  ],
};

const FORMATS = [
  "header", "bold", "italic", "underline", "strike",
  "list", "indent", "blockquote", "code-block", "code", "link", "align", "script",
];

export default function QuillEditor({ value, onChange, placeholder }) {
  const handleChange = (html) => {
    let cleaned = html
      .replace(/\s*color:\s*rgb\([^)]+\);?/gi, "")
      .replace(/\s*color:\s*#[0-9a-f]{3,8};?/gi, "")
      .replace(/\s*background-color:\s*rgb\(255,\s*255,\s*255\);?/gi, "")
      .replace(/\s*style="\s*"/g, "");
    const isEmpty = cleaned === "<p><br></p>";
    onChange?.(isEmpty ? "" : cleaned);
  };

  return (
    <ReactQuill
      theme="snow"
      value={value || ""}
      onChange={handleChange}
      modules={MODULES}
      formats={FORMATS}
      placeholder={placeholder || "Start writing..."}
    />
  );
}
