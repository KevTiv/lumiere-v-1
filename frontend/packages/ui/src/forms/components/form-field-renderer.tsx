"use client"

import * as React from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon, FileIcon, X, Sparkles } from "lucide-react"
import { format } from "date-fns"
import type { ParsedFormField, FieldType, FieldOption, FieldValidation } from "../config/types"
import { isCustomField } from "../config/types"

// ═════════════════════════════════════════════════════════════════════════════
// FIELD RENDERER COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

interface FormFieldRendererProps {
  field: ParsedFormField
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function FormFieldRenderer({
  field,
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: FormFieldRendererProps) {
  const renderField = () => {
    switch (field.type) {
      case "Text":
      case "Email":
      case "Password":
      case "Tel":
      case "Url":
        return (
          <Input
            type={field.type.toLowerCase()}
            placeholder={field.placeholder}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            className={cn(error && "border-red-500")}
          />
        )

      case "Textarea":
        return (
          <Textarea
            placeholder={field.placeholder}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            className={cn(error && "border-red-500", "min-h-[100px]")}
          />
        )

      case "Number":
        return (
          <Input
            type="number"
            placeholder={field.placeholder}
            value={(value as number) || ""}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            onBlur={onBlur}
            disabled={disabled}
            className={cn(error && "border-red-500")}
          />
        )

      case "Select":
        return (
          <Select
            value={(value as string) || ""}
            onValueChange={onChange}
            disabled={disabled}
          >
            <SelectTrigger className={cn(error && "border-red-500")}>
              <SelectValue placeholder={field.placeholder || "Select..."} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    {option.color && (
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: option.color }}
                      />
                    )}
                    {option.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case "MultiSelect":
        return (
          <MultiSelectField
            options={field.options || []}
            value={(value as string[]) || []}
            onChange={onChange}
            placeholder={field.placeholder}
            disabled={disabled}
          />
        )

      case "Checkbox":
        return (
          <Checkbox
            checked={(value as boolean) || false}
            onCheckedChange={onChange}
            disabled={disabled}
          />
        )

      case "Switch":
        return (
          <Switch
            checked={(value as boolean) || false}
            onCheckedChange={onChange}
            disabled={disabled}
          />
        )

      case "Radio":
        return (
          <RadioGroup
            value={(value as string) || ""}
            onValueChange={onChange}
            disabled={disabled}
            className="flex flex-col gap-2"
          >
            {field.options?.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <RadioGroupItem value={option.value} id={`${field.fieldId}-${option.value}`} />
                <label
                  htmlFor={`${field.fieldId}-${option.value}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
                >
                  {option.color && (
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  {option.label}
                </label>
              </div>
            ))}
          </RadioGroup>
        )

      case "Date":
        return (
          <DatePicker
            value={(value as string) || ""}
            onChange={onChange}
            disabled={disabled}
          />
        )

      case "DateTime":
        return (
          <DateTimePicker
            value={(value as string) || ""}
            onChange={onChange}
            disabled={disabled}
          />
        )

      case "Rating":
        return (
          <RatingField
            value={(value as number) || 0}
            onChange={onChange}
            max={field.validation?.max || 5}
            disabled={disabled}
          />
        )

      case "Slider":
        return (
          <div className="space-y-2">
            <Slider
              value={[(value as number) || field.validation?.min || 0]}
              onValueChange={([v]) => onChange(v)}
              min={field.validation?.min || 0}
              max={field.validation?.max || 10}
              step={1}
              disabled={disabled}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{field.validation?.min || 0}</span>
              <span className="font-medium">{value || field.validation?.min || 0}</span>
              <span>{field.validation?.max || 10}</span>
            </div>
          </div>
        )

      case "Tags":
        return (
          <TagsField
            value={(value as string[]) || []}
            onChange={onChange}
            placeholder={field.placeholder}
            disabled={disabled}
          />
        )

      case "File":
        return (
          <FileUploadField
            value={(value as File[]) || []}
            onChange={onChange}
            disabled={disabled}
          />
        )

      case "UserSelect":
        return (
          <UserSelectField
            value={(value as string) || ""}
            onChange={onChange}
            disabled={disabled}
          />
        )

      default:
        return (
          <Input
            placeholder="Unsupported field type"
            disabled
            value={`Unsupported: ${field.type}`}
          />
        )
    }
  }

  return (
    <div className="space-y-2">
      {renderField()}
      {field.aiSuggestions && field.aiSuggestions.length > 0 && (
        <AISuggestions
          suggestions={field.aiSuggestions}
          onSelect={(suggestion) => onChange(suggestion)}
        />
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function MultiSelectField({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: FieldOption[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue))
    } else {
      onChange([...value, optionValue])
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Badge
          key={option.value}
          variant={value.includes(option.value) ? "default" : "outline"}
          className={cn(
            "cursor-pointer transition-colors",
            disabled && "cursor-not-allowed opacity-50"
          )}
          onClick={() => !disabled && toggleOption(option.value)}
        >
          {option.color && (
            <div
              className="w-2 h-2 rounded-full mr-1"
              style={{ backgroundColor: option.color }}
            />
          )}
          {option.label}
        </Badge>
      ))}
    </div>
  )
}

function DatePicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const date = value ? new Date(value) : undefined

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground"
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => onChange(d ? d.toISOString() : "")}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

function DateTimePicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const date = value ? new Date(value) : undefined

  return (
    <div className="flex gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !value && "text-muted-foreground"
            )}
            disabled={disabled}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "PPP") : <span>Pick date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              if (d) {
                const currentDate = date || new Date()
                d.setHours(currentDate.getHours(), currentDate.getMinutes())
                onChange(d.toISOString())
              } else {
                onChange("")
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        className="w-[140px]"
        disabled={disabled}
        value={date ? format(date, "HH:mm") : ""}
        onChange={(e) => {
          if (date && e.target.value) {
            const [hours, minutes] = e.target.value.split(":")
            const newDate = new Date(date)
            newDate.setHours(parseInt(hours), parseInt(minutes))
            onChange(newDate.toISOString())
          }
        }}
      />
    </div>
  )
}

function RatingField({
  value,
  onChange,
  max,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  max: number
  disabled?: boolean
}) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          className={cn(
            "text-2xl transition-colors",
            star <= value ? "text-yellow-400" : "text-gray-300",
            disabled && "cursor-not-allowed"
          )}
          onClick={() => onChange(star)}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function TagsField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [inputValue, setInputValue] = React.useState("")

  const addTag = () => {
    if (inputValue.trim() && !value.includes(inputValue.trim())) {
      onChange([...value, inputValue.trim()])
      setInputValue("")
    }
  }

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            {!disabled && (
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => removeTag(tag)}
              />
            )}
          </Badge>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Input
            placeholder={placeholder || "Add tag..."}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addTag()
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addTag}>
            Add
          </Button>
        </div>
      )}
    </div>
  )
}

function FileUploadField({
  value,
  onChange,
  disabled,
}: {
  value: File[]
  onChange: (value: File[]) => void
  disabled?: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      onChange([...value, ...newFiles])
    }
  }

  const removeFile = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((file, index) => (
            <Badge key={index} variant="secondary" className="gap-1">
              <FileIcon className="h-3 w-3" />
              {file.name}
              {!disabled && (
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => removeFile(index)}
                />
              )}
            </Badge>
          ))}
        </div>
      )}
      {!disabled && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <FileIcon className="mr-2 h-4 w-4" />
            Upload Files
          </Button>
        </div>
      )}
    </div>
  )
}

function UserSelectField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  // TODO: Connect to actual users list from SpacetimeDB
  const mockUsers = [
    { id: "user-1", name: "John Doe" },
    { id: "user-2", name: "Jane Smith" },
    { id: "user-3", name: "Bob Johnson" },
  ]

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Select user..." />
      </SelectTrigger>
      <SelectContent>
        {mockUsers.map((user) => (
          <SelectItem key={user.id} value={user.id}>
            {user.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AISuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: string[]
  onSelect: (suggestion: string) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Sparkles className="h-3 w-3 text-primary" />
      <span className="text-xs text-muted-foreground">Suggestions:</span>
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="text-xs text-primary hover:underline"
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}
