# Dog Burger

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Customers using the Brazilian Portuguese application to order food for delivery or in-store pickup and track their orders.
- Staff using the internal management dashboard to operate the store. Preserve existing staff roles and access permissions.

## Product Purpose

Enable fast, simple customer ordering and practical, efficient store operations. Customer-facing ordering and the internal dashboard are parts of the same product.

## Operating Context

- Customer authentication, ordering, and order tracking must remain available.
- Orders support delivery and in-store pickup.
- Staff manage orders with real-time updates, status changes, cancellation reasons, sound notifications, and receipt printing.
- Staff maintain the menu, inventory, administrative reports, performance indicators, and custom date filters.

## Capabilities and Constraints

- Preserve the existing application architecture, database structures, business logic, business rules, and working features. Do not rebuild the application from scratch or remove functionality.
- Do not change business rules or database structures solely for visual improvements.
- Preserve menu management for products, categories, prices, ingredients, images, and availability.
- Keep inventory simple: manually update available product quantities and automatically mark products unavailable when quantities reach zero.
- Preserve configurable delivery fees, minimum order thresholds, store hours, contact information, and promotional pop-ups.
- Reuse existing components and design patterns wherever possible.
- Focus future interface work primarily on visual refinement, consistency, responsiveness, and usability.
- Unspecified product decisions remain open. Distinctive positioning, additional product claims, and specific accessibility standards have not been established.

## Brand Commitments

- Preserve the Dog Burger name, original brand colors, official logo, and authentic product photography.
- The user requests a modern, premium, minimalist visual language: balanced dark gradients, subtle orange accents, clean typography, consistent SVG icons, and restrained animation.
- Avoid excessive gradients, unnecessary decoration, emojis as interface icons, and fictional product images.
- These are user-confirmed constraints for future work; init does not define a new visual system or authorize interface changes.

## Evidence on Hand

- Existing application: root HTML pages, shared `css/` stylesheets, and `js/` application code.
- Brand image referenced by the application: `dogburger.png`; preserve the official logo.
- Existing promotional assets: `promo-terca-triplo.png` and `promo-terca-triplo-v2.png`. Their current offer validity is unconfirmed.
- Operational and data documentation lives in `docs/`; Supabase files live in `supabase/`.
- Authentic product photography is a required asset source. Its complete inventory is not established; do not fabricate replacement product images.
- No testimonials, market comparisons, or performance claims were confirmed during initialization.

## Product Principles

- Protect working customer and staff workflows during interface improvements.
- Make customer ordering fast and simple.
- Keep store management practical, organized, and efficient.
- Preserve the authentic brand and product assets.
- Leave unspecified decisions open rather than inventing requirements.

## Accessibility & Inclusion

Prioritize mobile responsiveness, accessibility, intuitive navigation, readable typography, and clear visual hierarchy across customer and staff interfaces. The product language is Brazilian Portuguese. Specific compliance standards and additional user needs remain undecided.
