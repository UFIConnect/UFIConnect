export function publishingOptionDefaults(schema, previous = {}) {
  const values = { ...previous };
  const choices = Array.isArray(schema?.destinations) ? schema.destinations : [];
  const validDestination = value => choices.some(choice => String(choice.id) === String(value || ''));
  if (!Object.hasOwn(previous, 'destinationId')) {
    const suggested = schema?.suggestedValues?.destinationId;
    values.destinationId = validDestination(suggested) ? String(suggested) : choices.length === 1 ? String(choices[0].id) : '';
  } else if (values.destinationId && !schema?.allowCustomDestination && !validDestination(values.destinationId)) {
    values.destinationId = '';
  }
  for (const field of schema?.fields || []) {
    if (field.type === 'select') {
      if (!field.options?.some(option => String(option.value) === String(values[field.key] ?? ''))) values[field.key] = '';
    } else if (field.type === 'checkbox' && field.required && values[field.key] === undefined) values[field.key] = false;
    else if (values[field.key] === undefined && field.default !== undefined) values[field.key] = field.default;
  }
  return values;
}

export function publishingOptionsReason(schema, values = {}) {
  if (!schema) return 'Loading publishing options.';
  if ((schema.destinations?.length || schema.allowCustomDestination || schema.destinationLabel) && !String(values.destinationId || '').trim()) return `Choose ${schema.destinationLabel || 'a destination'}.`;
  if (values.destinationId && !schema.allowCustomDestination && schema.destinations?.length && !schema.destinations.some(item => String(item.id) === String(values.destinationId))) return 'Choose an available destination.';
  for (const field of schema.fields || []) {
    const value = values[field.key];
    if (field.required && (field.type === 'checkbox' ? value !== true : !String(value ?? '').trim())) return `Complete ${field.label}.`;
    if (value && field.type === 'select' && !field.options?.some(option => String(option.value) === String(value))) return `Choose an available ${field.label}.`;
    if (field.maxLength && String(value ?? '').length > field.maxLength) return `Shorten ${field.label} to ${field.maxLength} characters.`;
  }
  return '';
}

export function publishingDestinationChanged(values, destinationId) {
  const next = { ...values, destinationId };
  if ('tagName' in next) next.tagName = '';
  return next;
}
