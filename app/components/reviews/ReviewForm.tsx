import { BlockStack, Checkbox, Select, Text, TextField } from "@shopify/polaris";
import { StarRating } from "./StarRating";
import styles from "./review-form.module.css";

export interface ReviewFormValues {
  productId: string;
  rating: number;
  title: string;
  content: string;
  reviewerName: string;
  reviewerEmail: string;
  reviewerLocation: string;
  verifiedPurchase: boolean;
  featured: boolean;
}

export type ReviewFormErrors = Partial<Record<keyof ReviewFormValues, string>>;

interface ReviewFormProps {
  mode: "create" | "edit";
  products: Array<{ id: string; name: string }>;
  values: ReviewFormValues;
  onChange: <K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) => void;
  errors?: ReviewFormErrors;
  disabled?: boolean;
}

export function ReviewForm({ mode, products, values, onChange, errors, disabled }: ReviewFormProps) {
  const productOptions = [
    { label: "Select a product", value: "" },
    ...products.map((product) => ({ label: product.name, value: product.id })),
  ];

  return (
    <BlockStack gap="400">
      <Select
        label="Product"
        options={productOptions}
        value={values.productId}
        onChange={(value) => onChange("productId", value)}
        error={errors?.productId}
        disabled={disabled || mode === "edit"}
        helpText={mode === "edit" ? "The product can't be changed after a review is created." : undefined}
      />

      <div className={styles.ratingField}>
        <Text as="p" variant="bodyMd">
          Rating
        </Text>
        <StarRating value={values.rating} onChange={(next) => onChange("rating", next)} size={26} />
        {errors?.rating ? (
          <Text as="p" tone="critical">
            {errors.rating}
          </Text>
        ) : null}
      </div>

      <TextField
        label="Title"
        value={values.title}
        onChange={(value) => onChange("title", value)}
        autoComplete="off"
        placeholder="Optional"
        disabled={disabled}
      />

      <TextField
        label="Review content"
        value={values.content}
        onChange={(value) => onChange("content", value)}
        autoComplete="off"
        multiline={5}
        error={errors?.content}
        disabled={disabled}
      />

      <TextField
        label="Reviewer name"
        value={values.reviewerName}
        onChange={(value) => onChange("reviewerName", value)}
        autoComplete="off"
        error={errors?.reviewerName}
        disabled={disabled}
      />

      <TextField
        label="Reviewer email"
        type="email"
        value={values.reviewerEmail}
        onChange={(value) => onChange("reviewerEmail", value)}
        autoComplete="off"
        placeholder="Optional"
        disabled={disabled}
      />

      <TextField
        label="Reviewer location"
        value={values.reviewerLocation}
        onChange={(value) => onChange("reviewerLocation", value)}
        autoComplete="off"
        placeholder="Optional"
        disabled={disabled}
      />

      <Checkbox
        label="Verified purchase"
        checked={values.verifiedPurchase}
        onChange={(value) => onChange("verifiedPurchase", value)}
        disabled={disabled}
      />

      <Checkbox
        label="Featured"
        checked={values.featured}
        onChange={(value) => onChange("featured", value)}
        disabled={disabled}
      />
    </BlockStack>
  );
}
