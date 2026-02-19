import { z } from "zod";

const textField = z
  .string()
  .trim()
  .max(2000, "Value is too long");

export const personUpdateSchema = z
  .object({
    display_name: z.string().trim().min(1, "Display name is required").max(140),
    phones: textField,
    address: textField,
    hobbies: textField,
    notes: textField,
  })
  .strict();