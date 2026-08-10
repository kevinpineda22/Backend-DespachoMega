/**
 * validate.js — Valida body / params / query con Zod antes de tocar la logica.
 *
 * Los datos ya parseados reemplazan a los originales: si un servicio recibe
 * `cantidad`, es un numero, no el string que llego por HTTP.
 */

/**
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} esquemas
 */
export function validate(esquemas) {
  return (req, _res, next) => {
    try {
      if (esquemas.params) req.params = esquemas.params.parse(req.params);
      if (esquemas.query) req.query = esquemas.query.parse(req.query);
      if (esquemas.body) req.body = esquemas.body.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
