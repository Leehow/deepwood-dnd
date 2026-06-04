/**
 * EditableField Component
 * Inline editable field with double-click to edit functionality
 */

import React, { useState, useRef, useEffect } from 'react';

interface EditableFieldProps {
  value: string | number | undefined | null;
  onSave: (newValue: string | number) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  suffix?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function EditableField({
  value,
  onSave,
  type = 'text',
  placeholder = '-',
  className = '',
  displayClassName = '',
  inputClassName = '',
  suffix = '',
  min,
  max,
  disabled = false,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(String(value ?? ''));
  }, [value]);

  const handleDoubleClick = () => {
    if (disabled) return;
    setIsEditing(true);
    setEditValue(String(value ?? ''));
  };

  const handleSave = () => {
    setIsEditing(false);
    let newValue: string | number = editValue;

    if (type === 'number') {
      const parsed = parseInt(editValue, 10);
      if (isNaN(parsed)) {
        setEditValue(String(value ?? ''));
        return;
      }
      newValue = parsed;
      if (min !== undefined && newValue < min) newValue = min;
      if (max !== undefined && newValue > max) newValue = max;
    }

    if (String(newValue) !== String(value)) {
      onSave(newValue);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(String(value ?? ''));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        className={`bg-gray-700 border border-amber-500/50 rounded px-2 py-1 text-white text-center focus:outline-none focus:ring-2 focus:ring-amber-500 ${inputClassName}`}
        style={{ width: type === 'number' ? '80px' : 'auto' }}
      />
    );
  }

  const displayValue = value ?? placeholder;
  const hasValue = value !== null && value !== undefined && value !== '';

  return (
    <span
      onDoubleClick={handleDoubleClick}
      className={`cursor-pointer hover:bg-amber-500/20 rounded px-1 transition-colors ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      } ${hasValue ? '' : 'text-gray-500'} ${displayClassName} ${className}`}
      title={disabled ? '' : '双击编辑'}
    >
      {displayValue}{hasValue && suffix}
    </span>
  );
}
