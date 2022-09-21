FROM public.ecr.aws/lambda/nodejs:14
# WORKDIR /app
COPY package*.json ./
# RUN npm install
# If you are building your code for production, instead include a package-lock.json file on this directory and use:
RUN npm ci --production
COPY . ./
# Command can be overwritten by providing a different command in the template directly.
CMD ["src/hanlders/rule-graph.ruleGraphHandler"]
