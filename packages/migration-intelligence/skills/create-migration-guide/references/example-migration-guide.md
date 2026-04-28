# Example Migration Guide

This is an example of a well-formed migration guide skill.

```markdown
---
name: java-ee-to-quarkus
description: >
  Migration plan for Java EE to Quarkus. Use when planning or executing
  a migration from JBoss EAP 7.4 / Java EE to Quarkus 3.x for the
  coolstore e-commerce application.
---

# Java EE to Quarkus Migration Plan

## Application Context

Monolith e-commerce application on JBoss EAP 7.4, migrating to Quarkus 3.x.
Uses EJB, JPA, JMS, and JAX-RS. ~45 services, ~200k LOC.

## Key Patterns

- Services use @Stateless — convert to @ApplicationScoped
- ShippingService uses @Remote — refactor to REST endpoint
- JMS with JMSContext — migrate to SmallRye Reactive Messaging with RabbitMQ
- EntityManager injected via @PersistenceContext — replace with @Inject
- JNDI lookups in DataSourceConfig — replace with application.properties

## Organizational Preferences

- Use RabbitMQ (not Kafka) for messaging
- Use RESTEasy Reactive (not Classic)
- Preserve Flyway migrations — do not modify schema files
- Use Quarkus Panache for new repository code where possible

## Things to Watch

- OrderService.save() needs explicit @Transactional
- CatalogService.updateInventoryItems() needs @Transactional
- CartService uses a custom session management pattern — discuss with team before migrating
- SecurityConfig extends a proprietary EAP base class — needs manual rewrite
```
