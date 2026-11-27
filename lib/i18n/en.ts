/**
 * ALL user-facing text for the storefront, in English.
 *
 * To add a language later (Arabic RTL, French): copy this file to ar.ts /
 * fr.ts with the same keys, translate the values, and pick the dictionary
 * in lib/i18n/index.ts. Never hard-code UI text in components.
 *
 * Placeholders like {name} are filled in with fill() from lib/i18n.
 *
 * Note: some error messages come from the database (place_order) and are
 * English only for now.
 */
export const en = {
  locale: "en-US",
  dir: "ltr" as "ltr" | "rtl",

  common: {
    loading: "Loading…",
    backToShop: "Back to shop",
    poweredBy: "Powered by {brand}",
    close: "Close",
  },

  shop: {
    notFoundTitle: "Shop not found",
    notFoundText: "This shop doesn't exist or is not open right now. Please check the link.",
    noProducts: "This shop has no products yet. Check back soon!",
    deliveryFee: "Delivery: {fee}",
    chatOnWhatsapp: "Chat on WhatsApp",
  },

  product: {
    notFoundTitle: "Product not found",
    notFoundText: "This product doesn't exist or is no longer available.",
    from: "From {price}",
    outOfStock: "Out of stock",
    soldOut: "Sold out",
    onlyLeft: "Only {count} left",
    chooseOption: "Choose a {option}",
    option: "option",
    quantity: "Quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    addToCart: "Add to cart",
    added: "Added to cart ✓",
    viewCart: "View cart",
    cartFull: "Your cart is full (max {max} different items).",
    noPhoto: "No photo",
  },

  cart: {
    title: "Your cart",
    open: "Cart",
    itemsCount: "{count} items",
    empty: "Your cart is empty.",
    continueShopping: "Continue shopping",
    remove: "Remove",
    subtotal: "Subtotal",
    delivery: "Delivery",
    total: "Total",
    checkout: "Checkout",
    pricesNote: "Final prices and stock are confirmed when you place the order.",
  },

  checkout: {
    title: "Checkout",
    yourDetails: "Your details",
    name: "Full name",
    phone: "Phone number",
    phoneHint: "Lebanese number, e.g. 70 123 456 or 03 123 456",
    area: "Area / town",
    areaHint: "e.g. Achrafieh, Jounieh, Tripoli",
    address: "Delivery address",
    addressHint: "Street, building, floor, landmark",
    notes: "Notes (optional)",
    notesHint: "Anything the shop should know",
    payment: "Payment",
    cod: "Cash on delivery",
    codHint: "Pay in cash when your order arrives.",
    summary: "Order summary",
    placeOrder: "Place order",
    placing: "Placing your order…",
    honeypotLabel: "Leave this field empty",
    errors: {
      name: "Please enter your name.",
      phone: "Please enter a valid Lebanese phone number.",
      address: "Please enter your delivery address.",
      tooLong: "Some of the text is too long.",
      emptyCart: "Your cart is empty.",
      generic: "Something went wrong. Please try again.",
    },
  },

  order: {
    title: "Order #{number} received",
    thanks: "Thank you, {name}!",
    stepTitle: "One last step: send your order on WhatsApp",
    stepText:
      "Your order is saved. Tap the button below to send it to {shop} on WhatsApp. Your order is confirmed once you send this message.",
    sendWhatsapp: "Send order on WhatsApp",
    noWhatsapp: "{shop} will contact you to confirm your order.",
    summary: "Order summary",
    payment: "Payment: {method}",
    expiredTitle: "Order details not available",
    expiredText:
      "For your privacy, order details are only shown right after you place an order on this device.",
    whatsappMessage: {
      greeting: "Hello {shop}! I just placed order #{number}:",
      line: "• {qty} × {name} ({total})",
      total: "Total: {total} (including delivery {fee})",
      name: "Name: {name}",
      area: "Area: {area}",
      payment: "Payment: {method}",
    },
  },

  // Emails sent to SHOP OWNERS (not customers).
  emails: {
    orderCreated: {
      subject: "New order #{number} - {customer} - {total}",
      heading: "New order #{number}",
      intro: "You have a new order on {shop}.",
      items: "Items",
      subtotal: "Subtotal",
      delivery: "Delivery",
      total: "Total",
      customer: "Customer",
      name: "Name",
      phone: "Phone",
      area: "Area",
      address: "Address",
      notes: "Notes",
      payment: "Payment",
      openOrder: "Open this order",
      footer: "You get this email because you are listed for new-order alerts for {shop}.",
    },
  },

  paymentMethods: {
    cod: "Cash on delivery",
    whish: "Whish",
  },

  notFound: {
    title: "Page not found",
    text: "We couldn't find this page.",
    home: "Go to home page",
  },
};

export type Dictionary = typeof en;
