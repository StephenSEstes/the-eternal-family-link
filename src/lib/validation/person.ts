import { z } from "zod";

const textField = z
  .string()
  .trim()
  .max(2000, "Value is too long");

export const personUpdateSchema = z
  .object({
    display_name: z.string().trim().min(1, "Display name is required").max(140),
    first_name: z.string().trim().max(80).optional(),
    middle_name: z.string().trim().max(80).optional(),
    last_name: z.string().trim().max(80).optional(),
    nick_name: z.string().trim().max(80).optional(),
    birth_date: z.string().trim().max(64),
    gender: z.enum(["male", "female", "unspecified"]).optional(),
    phones: textField,
    address: textField,
    hobbies: textField,
    notes: textField,
  })
  .strict();
