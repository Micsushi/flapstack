import { z } from "zod"
import { betaProcedure, router } from "../index"
import { getDatabase } from "../../db"
import { DiffAnnotationService } from "../../diff-annotations/service"
import {
  diffAnnotationScopeSchema,
  createDiffAnnotationSchema,
  changeDiffAnnotationSchema,
  diffAnnotationAnchorSchema,
  diffAnnotationBodySchema,
} from "../../../../shared/diff-annotations"

const procedure = betaProcedure("diffAnnotations")
const service = () => new DiffAnnotationService(getDatabase())
export const diffAnnotationsRouter = router({
  list: procedure.input(diffAnnotationScopeSchema).query(({ input }) => service().list(input)),
  create: procedure
    .input(createDiffAnnotationSchema)
    .mutation(({ input }) => service().create(input)),
  revise: procedure
    .input(
      changeDiffAnnotationSchema.extend({
        anchor: diffAnnotationAnchorSchema,
        body: diffAnnotationBodySchema,
      }),
    )
    .mutation(({ input }) => service().revise(input)),
  setDeleted: procedure
    .input(changeDiffAnnotationSchema.extend({ deleted: z.boolean() }))
    .mutation(({ input }) => service().setDeleted(input)),
})
