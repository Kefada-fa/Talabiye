/**
 * ALL user-facing text for the storefront, in English.
 *
 * To add a language later (Arabic RTL, French): copy this file to ar.ts /
 * fr.ts with the same keys, translate the values, and pick the dictionary
 * in lib/i18n/index.ts. Never hard-code UI text in components.
 *
 * Placeholders like {name} are filled in with fill() from lib/i18n.
 *
 * Product-neutral: never say "size" — option names come from the seller
 * ("Size", "Flavor", "Color"…) and are inserted with {option}.
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
    deliveryFrom: "Delivery from {fee}",
    deliveryFixed: "Delivery: {fee}",
    freeDeliveryAbove: "Free delivery on orders of {amount} or more",
    pickupOnly: "Pickup only",
    chatOnWhatsapp: "Chat on WhatsApp",
  },

  product: {
    notFoundTitle: "Product not found",
    notFoundText: "This product doesn't exist or is no longer available.",
    from: "From {price}",
    sale: "Sale",
    wasPrice: "Was {price}",
    outOfStock: "Out of stock",
    soldOut: "Sold out",
    combinationSoldOut: "This combination is sold out. Please choose another one.",
    onlyLeft: "Only {count} left",
    choose: "Choose {option}",
    option: "an option",
    quantity: "Quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    addToCart: "Add to cart",
    added: "Added to cart ✓",
    viewCart: "View cart",
    cartFull: "Your cart is full (max {max} different items).",
    noPhoto: "No photo",
    brand: "Brand: {brand}",
    weight: "Weight: {weight}",
    expiry: "Best before: {date}",
    code: "Item code: {code}",
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
    deliveryAtCheckout: "Calculated at checkout",
    free: "Free",
    total: "Total",
    checkout: "Checkout",
    pricesNote: "Final prices and stock are confirmed when you place the order.",
  },

  checkout: {
    title: "Checkout",
    yourDetails: "Your details",
    name: "Full name",
    phone: "Mobile number",
    phoneHint: "Lebanese mobile, e.g. 03 123 456 or 70 123 456",
    howToGet: "How do you want to get your order?",
    delivery: "Delivery",
    deliveryHint: "We bring it to your address.",
    pickup: "Pickup",
    pickupHint: "You collect it from the shop.",
    deliveryNotAvailable: "This shop does not deliver at the moment.",
    address: "Delivery address",
    governorate: "Governorate",
    chooseGovernorate: "Choose a governorate",
    district: "District",
    chooseDistrict: "Choose a district",
    notDelivered: "{name} (no delivery)",
    city: "City / town",
    cityHint: "e.g. Achrafieh, Jounieh, Zahle",
    neighbourhood: "Neighbourhood (optional)",
    street: "Street",
    details: "Building, floor, landmark (optional)",
    notes: "Notes (optional)",
    notesHint: "Anything the shop should know",
    policyTitle: "Shop policy",
    policyAgree: "I have read and agree to the shop policy.",
    payment: "Payment",
    cod: "Cash on delivery",
    codHint: "Pay in cash when you receive your order.",
    summary: "Order summary",
    freeDeliveryHint: "Free delivery on orders of {amount} or more.",
    placeOrder: "Place order",
    placing: "Placing your order…",
    honeypotLabel: "Leave this field empty",
    stockTitle: "Some items are no longer available in the quantity you chose:",
    stockLine: "{name}: you asked for {requested}, {available} left",
    stockLineSoldOut: "{name}: sold out",
    fixCart: "Update my cart",
    cartFixed: "Your cart was updated. Please check it and place your order again.",
    errors: {
      name: "Please enter your name.",
      phone: "Please type a valid Lebanese mobile number, for example 03 123 456 or 70 123 456.",
      method: "Please choose delivery or pickup.",
      governorate: "Please choose your governorate.",
      district: "Please choose your district.",
      city: "Please enter your city or town.",
      street: "Please enter your street.",
      policy: "Please accept the shop policy.",
      tooLong: "Some of the text is too long.",
      emptyCart: "Your cart is empty.",
      tooFast: "Please take a moment to check your order, then press “Place order” again.",
      expired: "This page was open for a long time. Please refresh the page and try again.",
      notConfigured: "Online ordering is not available right now. Please contact the shop on WhatsApp.",
      generic: "Something went wrong. Please try again.",
    },
  },

  order: {
    title: "Order {number} received",
    thanks: "Thank you, {name}!",
    stepTitle: "One last step: send your order on WhatsApp",
    stepText:
      "Your order is saved. Tap the button below to send it to {shop} on WhatsApp. Your order is confirmed once you send this message.",
    sendWhatsapp: "Send order on WhatsApp",
    noWhatsapp: "{shop} will contact you to confirm your order.",
    summary: "Order summary",
    payment: "Payment: {method}",
    deliveryTo: "Delivery to: {place}",
    pickup: "Pickup from the shop",
    expiredTitle: "Order details not available",
    expiredText:
      "For your privacy, order details are only shown right after you place an order on this device.",
    whatsappMessage: {
      greeting: "Hello {shop}! I just placed order {number}:",
      line: "• {qty} × {name} ({total})",
      delivery: "Delivery: {fee}",
      freeDelivery: "Delivery: free",
      total: "Total: {total}",
      name: "Name: {name}",
      deliveryTo: "Delivery to: {place}",
      pickup: "I will pick it up from the shop.",
      payment: "Payment: {method}",
    },
  },

  // Emails sent to SHOP OWNERS (not customers).
  emails: {
    orderCreated: {
      subject: "New order {number} - {customer} - {total}",
      heading: "New order {number}",
      intro: "You have a new order on {shop}.",
      items: "Items",
      subtotal: "Subtotal",
      delivery: "Delivery",
      free: "Free",
      total: "Total",
      customer: "Customer",
      name: "Name",
      phone: "Phone",
      method: "Method",
      pickup: "Pickup",
      deliveryMethod: "Delivery",
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
